/**
 * @fileoverview Two-mode bundle-size action.
 *   mode=measure  → walk dist files, sum raw/gzip/brotli, emit JSON
 *   mode=compare  → diff two measure outputs, post PR comment
 * Batch 5.4 from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.npm.jobs.bundle-size
 */

import fs from "node:fs";
import path from "node:path";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

/** Recursive directory walk matching a glob (very simple: `*` and `**` only). */
function* walk(dir) {
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(p);
		else if (entry.isFile()) yield p;
	}
}

/** Convert glob to regex (handles `**` and `*` only). Anchored. */
function globRegex(glob) {
	let re = "^";
	let i = 0;
	while (i < glob.length) {
		const c = glob[i];
		if (c === "*" && glob[i + 1] === "*") {
			re += ".*";
			i += 2;
			if (glob[i] === "/") i++;
			continue;
		}
		if (c === "*") re += "[^/]*";
		else if (c === ".") re += "\\.";
		else if ("()+|^$\\".includes(c)) re += "\\" + c;
		else re += c;
		i++;
	}
	return new RegExp(re + "$");
}

function formatBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDelta(d) {
	const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
	return `${sign}${formatBytes(Math.abs(d))}`;
}

async function measure() {
	const distPatterns = (getInput("dist_paths") || "dist/**").split(",").map((s) => s.trim()).filter(Boolean);
	const outputFile = getInput("output_file") || "sizes.json";

	const regexes = distPatterns.map(globRegex);
	const files = [];
	// Walk possible roots (everything before the first wildcard).
	const roots = new Set();
	for (const pattern of distPatterns) {
		const cut = pattern.search(/[*?]/);
		const root = cut === -1 ? pattern : pattern.slice(0, cut).replace(/\/$/, "");
		roots.add(root || ".");
	}

	for (const root of roots) {
		for (const filePath of walk(root)) {
			const rel = filePath.split(path.sep).join("/");
			if (regexes.some((re) => re.test(rel))) {
				const buf = fs.readFileSync(filePath);
				const gzip = gzipSync(buf, { level: 9 }).length;
				const brotli = brotliCompressSync(buf, {
					params: { [constants.BROTLI_PARAM_QUALITY]: 11 }
				}).length;
				files.push({ path: rel, raw: buf.length, gzip, brotli });
			}
		}
	}

	files.sort((a, b) => a.path.localeCompare(b.path));
	const total = files.reduce(
		(acc, f) => ({ raw: acc.raw + f.raw, gzip: acc.gzip + f.gzip, brotli: acc.brotli + f.brotli }),
		{ raw: 0, gzip: 0, brotli: 0 }
	);
	const result = { files, total };

	fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
	console.log(`📊 Measured ${files.length} files`);
	console.log(`   raw    : ${formatBytes(total.raw)}`);
	console.log(`   gzip   : ${formatBytes(total.gzip)}`);
	console.log(`   brotli : ${formatBytes(total.brotli)}`);
}

async function compare() {
	const headPath = getInput("head_sizes", { required: true });
	const basePath = getInput("base_sizes", { required: true });
	const prNumber = getInput("pr_number", { required: true });
	const warningPct = Number(getInput("warning_pct") || 5);
	const warningBytes = Number(getInput("warning_bytes") || 500);
	const commentMode = getInput("comment_mode") || "update";
	const token = getInput("github_token", { required: true });

	const head = JSON.parse(fs.readFileSync(headPath, "utf8"));
	const base = JSON.parse(fs.readFileSync(basePath, "utf8"));

	const baseMap = new Map(base.files.map((f) => [f.path, f]));
	const headMap = new Map(head.files.map((f) => [f.path, f]));
	const allPaths = new Set([...baseMap.keys(), ...headMap.keys()]);

	const rows = [];
	let anyWarning = false;
	for (const p of [...allPaths].sort()) {
		const h = headMap.get(p) || { raw: 0, gzip: 0, brotli: 0 };
		const b = baseMap.get(p) || { raw: 0, gzip: 0, brotli: 0 };
		const dRaw = h.raw - b.raw;
		const dGzip = h.gzip - b.gzip;
		const pctRaw = b.raw === 0 ? 100 : (dRaw / b.raw) * 100;
		let marker = "";
		if (dRaw > 0 && (Math.abs(pctRaw) >= warningPct || dRaw >= warningBytes)) {
			marker = " ⚠️";
			anyWarning = true;
		} else if (dRaw < 0) {
			marker = " ✅";
		}
		rows.push(
			`| ${p} | ${formatBytes(h.raw)} | ${dRaw === 0 ? "—" : `${formatDelta(dRaw)} (${pctRaw >= 0 ? "+" : ""}${pctRaw.toFixed(1)}%)`}${marker} | ${formatBytes(h.gzip)} | ${dGzip === 0 ? "—" : formatDelta(dGzip)} |`
		);
	}

	const totalRawDelta = head.total.raw - base.total.raw;
	const totalGzipDelta = head.total.gzip - base.total.gzip;
	rows.push(`| **Total** | ${formatBytes(head.total.raw)} | **${formatDelta(totalRawDelta)}** | ${formatBytes(head.total.gzip)} | **${formatDelta(totalGzipDelta)}** |`);

	const heading = anyWarning ? "## ⚠️ Bundle size increased" : totalRawDelta < 0 ? "## ✅ Bundle size decreased" : "## 📦 Bundle size unchanged";
	const body = [
		heading,
		"",
		"| File | Raw | Δ Raw | Gzipped | Δ Gzipped |",
		"|------|----:|------:|--------:|----------:|",
		...rows,
		"",
		"<sub>📊 Generated by [`bundle-size`](https://github.com/CLDMV/.github/blob/master/.github/actions/npm/jobs/bundle-size). Brotli sizes also measured but omitted from the table for brevity.</sub>"
	].join("\n");

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	const marker = "<!-- bundle-size-comment -->";
	const finalBody = `${marker}\n${body}`;

	if (commentMode === "update") {
		// Find prior comment by marker
		const comments = await api("GET", `/issues/${prNumber}/comments?per_page=100`, null, { token, owner, repo });
		const prior = Array.isArray(comments) ? comments.find((c) => c.body?.includes(marker)) : null;
		if (prior) {
			console.log(`💬 Updating prior bundle-size comment #${prior.id}`);
			await api("PATCH", `/issues/comments/${prior.id}`, { body: finalBody }, { token, owner, repo });
			appendSummary(`✏️ Updated bundle-size comment on PR #${prNumber}`);
			return;
		}
	}
	console.log(`💬 Posting new bundle-size comment to PR #${prNumber}`);
	await api("POST", `/issues/${prNumber}/comments`, { body: finalBody }, { token, owner, repo });
	appendSummary(`💬 Posted bundle-size comment on PR #${prNumber}`);
}

try {
	const mode = getInput("mode", { required: true });
	if (mode === "measure") await measure();
	else if (mode === "compare") await compare();
	else throw new Error(`mode must be 'measure' or 'compare', got "${mode}"`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
