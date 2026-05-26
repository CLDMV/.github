#!/usr/bin/env node
/**
 * @fileoverview Integrity check for the CLDMV CLA signatures ledger.
 *
 * Walks every signature file, recomputes its `signature_id` from the canonical
 * form of the record, and reports any mismatches. Also regenerates the
 * `cla-versions/*.sha256` files from the corresponding `.md` source.
 *
 * Run from the root of a clone of CLDMV/.cla-signatures.
 *
 * Usage:
 *   node tools/verify.mjs                  Verify all signature records
 *   node tools/verify.mjs --regen-hashes   Regenerate cla-versions/*.sha256 files
 *   node tools/verify.mjs --help
 *
 * @module @cldmv/.cla-signatures.tools.verify
 */

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
	process.stdout.write(
		[
			"Usage:",
			"  node tools/verify.mjs                  Verify all signature records",
			"  node tools/verify.mjs --regen-hashes   Regenerate cla-versions/*.sha256 files",
			"  node tools/verify.mjs --help",
			""
		].join("\n")
	);
}

async function pathExists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Recursively collect all `.json` files under a directory.
 */
async function walkJson(dir) {
	const out = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			out.push(...(await walkJson(p)));
		} else if (e.isFile() && e.name.endsWith(".json")) {
			out.push(p);
		}
	}
	return out;
}

/**
 * Produce a deterministic canonical form of an object for hashing.
 * Keys are sorted recursively; arrays preserve order; strings, numbers, and
 * booleans are passed through as-is.
 */
function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		const out = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = canonicalize(value[key]);
		}
		return out;
	}
	return value;
}

function computeSignatureId(record) {
	const { signature_id, ...rest } = record;
	const canonical = JSON.stringify(canonicalize(rest));
	return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

async function regenerateClaHashes() {
	const dir = join(REPO_ROOT, "cla-versions");
	if (!(await pathExists(dir))) {
		process.stdout.write("No cla-versions/ directory found.\n");
		return;
	}
	const entries = await readdir(dir);
	let regenerated = 0;
	for (const name of entries) {
		if (!name.endsWith(".md")) continue;
		const mdPath = join(dir, name);
		const shaPath = join(dir, name.replace(/\.md$/, ".sha256"));
		const content = await readFile(mdPath);
		const digest = "sha256:" + createHash("sha256").update(content).digest("hex");
		await writeFile(shaPath, `${digest}\n`, "utf8");
		regenerated++;
		process.stdout.write(`  ${relative(REPO_ROOT, shaPath)}  ${digest}\n`);
	}
	process.stdout.write(`Regenerated ${regenerated} hash file(s).\n`);
}

async function verifySignatures() {
	const sigDir = join(REPO_ROOT, "signatures");
	if (!(await pathExists(sigDir))) {
		process.stdout.write("No signatures/ directory found — ledger is empty.\n");
		return { checked: 0, mismatches: [] };
	}
	const files = await walkJson(sigDir);
	const mismatches = [];
	for (const file of files) {
		let record;
		try {
			record = JSON.parse(await readFile(file, "utf8"));
		} catch (err) {
			mismatches.push({ file, error: `parse: ${err.message}` });
			continue;
		}
		const stored = record.signature_id ?? null;
		const recomputed = computeSignatureId(record);
		if (stored !== recomputed) {
			mismatches.push({ file, stored, recomputed });
		}
	}
	return { checked: files.length, mismatches };
}

async function main() {
	const argv = process.argv.slice(2);
	if (argv.includes("--help") || argv.includes("-h")) {
		usage();
		return;
	}
	if (argv.includes("--regen-hashes")) {
		await regenerateClaHashes();
		return;
	}

	const { checked, mismatches } = await verifySignatures();
	process.stdout.write(`Checked ${checked} signature record(s).\n`);
	if (mismatches.length === 0) {
		process.stdout.write("✅ All records verify.\n");
		return;
	}
	process.stdout.write(`❌ ${mismatches.length} mismatch(es):\n`);
	for (const m of mismatches) {
		process.stdout.write(`  ${relative(REPO_ROOT, m.file)}\n`);
		if (m.error) {
			process.stdout.write(`    error: ${m.error}\n`);
		} else {
			process.stdout.write(`    stored:     ${m.stored}\n`);
			process.stdout.write(`    recomputed: ${m.recomputed}\n`);
		}
	}
	process.exit(1);
}

main().catch((err) => {
	process.stderr.write(`${err.message}\n`);
	process.exit(1);
});
