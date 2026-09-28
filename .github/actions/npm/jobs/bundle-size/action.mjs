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

/** Directories the walk never descends into — nothing under them is a published file. */
const SKIP_DIRS = new Set(["node_modules", ".git"]);

/**
 * Recursive walk of a pattern root. A directory yields every file beneath it; a
 * plain file (a wildcard-free pattern such as `index.mjs`) yields itself, so a
 * single-file entry in `dist_paths` is measured instead of silently skipped.
 * Subdirectories named in SKIP_DIRS, and any the `canDescend(relPath)` predicate
 * rejects (no pattern can match beneath them), are not entered.
 */
function* walk(dir, canDescend = () => true) {
	if (!fs.existsSync(dir)) return;
	const stat = fs.statSync(dir);
	if (stat.isFile()) {
		yield dir;
		return;
	}
	if (!stat.isDirectory()) return;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || !canDescend(p.split(path.sep).join("/"))) continue;
			yield* walk(p, canDescend);
		} else if (entry.isFile()) yield p;
	}
}

/** Strip leading `./` segments: walked paths are recorded without them. */
function normalizePattern(pattern) {
	let p = pattern;
	while (p.startsWith("./")) p = p.slice(2);
	return p;
}

/** Walk root for a pattern: the whole path segments before the first wildcard. */
function patternRoot(pattern) {
	const segments = pattern.split("/");
	const firstWild = segments.findIndex((seg) => /[*?]/.test(seg));
	if (firstWild === -1) return pattern;
	return segments.slice(0, firstWild).join("/") || ".";
}

/**
 * Whether files matching `pattern` could exist beneath directory `dirRel` — i.e.
 * each of the dir's segments matches the pattern's segment at that depth (a `**`
 * segment matches any remainder) and the pattern has segments left for a file.
 */
function canContainMatch(dirRel, pattern) {
	const dirSegs = dirRel.split("/");
	const patSegs = pattern.split("/");
	for (let i = 0; i < dirSegs.length; i++) {
		const seg = patSegs[i];
		if (seg === undefined) return false;
		if (seg.includes("**")) return true;
		if (!globRegex(seg).test(dirSegs[i])) return false;
	}
	return patSegs.length > dirSegs.length;
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
	const distPatterns = (getInput("dist_paths") || "dist/**")
		.split(",")
		.map((s) => normalizePattern(s.trim()))
		.filter(Boolean);
	const outputFile = getInput("output_file") || "sizes.json";

	const regexes = distPatterns.map(globRegex);
	const files = [];
	const seen = new Set();
	// Walk each pattern's root (the whole segments before its first wildcard),
	// descending only into directories some pattern can still match beneath.
	const roots = new Set(distPatterns.map(patternRoot));
	const canDescend = (dirRel) => distPatterns.some((pattern) => canContainMatch(dirRel, pattern));

	for (const root of roots) {
		for (const filePath of walk(root, canDescend)) {
			const rel = filePath.split(path.sep).join("/");
			if (seen.has(rel)) continue;
			if (regexes.some((re) => re.test(rel))) {
				seen.add(rel);
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
	const total = files.reduce((acc, f) => ({ raw: acc.raw + f.raw, gzip: acc.gzip + f.gzip, brotli: acc.brotli + f.brotli }), {
		raw: 0,
		gzip: 0,
		brotli: 0
	});
	const result = { files, total };

	fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
	if (files.length === 0) {
		// Misconfigured dist_paths (or a build that emitted nothing) would otherwise
		// surface only as an empty size table — flag it in the job log and summary.
		// Not a failure: the measurement still completes and the job still passes.
		const message = `dist_paths matched 0 files (${distPatterns.join(", ")}). Set dist_paths to the files the package publishes — see \`npm pack --dry-run\` or package.json \`files\`.`;
		console.log(`::warning title=Bundle size - no files measured::${message}`);
		appendSummary(`⚠️ ${message}`);
	}
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
	rows.push(
		`| **Total** | ${formatBytes(head.total.raw)} | **${formatDelta(totalRawDelta)}** | ${formatBytes(head.total.gzip)} | **${formatDelta(totalGzipDelta)}** |`
	);

	const heading = anyWarning
		? "## ⚠️ Bundle size increased"
		: totalRawDelta < 0
			? "## ✅ Bundle size decreased"
			: "## 📦 Bundle size unchanged";
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
