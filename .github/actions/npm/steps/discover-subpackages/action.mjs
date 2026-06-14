/**
 * @fileoverview Resolve the `extra_packages` input into a satellite publish matrix.
 * Accepts either a JSON array of `{ name, dir }` entries or one/more whitespace-
 * separated glob patterns (e.g. `dist-packages/*`). Globs are expanded against the
 * current working directory (the downloaded build artifact); each resolved directory
 * must contain a package.json, whose `name` is used when not supplied explicitly.
 * Emits `matrix` (JSON array for strategy.matrix.include) and `has-extras`.
 * @module @cldmv/.github.npm.steps.discover-subpackages
 */

import fs from "node:fs";
import path from "node:path";
import { getInput, setOutput } from "../../../common/common/core.mjs";

/** Normalise a directory string: strip a leading ./ and trailing slashes. */
const norm = (d) => String(d).replace(/^\.\//, "").replace(/\/+$/, "");

/**
 * Read a directory's package.json name.
 * @param {string} dir - Directory to inspect.
 * @returns {{ name: string, dir: string } | null} Entry, or null if no usable package.json.
 */
function readPkg(dir) {
	const pj = path.join(dir, "package.json");
	if (!fs.existsSync(pj)) return null;
	try {
		const { name } = JSON.parse(fs.readFileSync(pj, "utf8"));
		return name ? { name, dir } : null;
	} catch {
		return null;
	}
}

/**
 * Expand a single-level glob (one `*` in the final path segment) against the filesystem.
 * Non-glob patterns resolve to themselves when they are an existing directory.
 * @param {string} pattern - e.g. "dist-packages/*" or "dist-packages/slothlet-*".
 * @returns {string[]} Matching directory paths.
 */
function expandGlob(pattern) {
	const pat = norm(pattern);
	if (!pat.includes("*")) {
		return fs.existsSync(pat) && fs.statSync(pat).isDirectory() ? [pat] : [];
	}
	const idx = pat.lastIndexOf("/");
	const base = idx === -1 ? "." : pat.slice(0, idx);
	const seg = idx === -1 ? pat : pat.slice(idx + 1);
	// Escape every regex metacharacter except `*` (our only wildcard, mapped to .*
	// below). `?` must be escaped too, else it acts as a regex quantifier.
	const re = new RegExp("^" + seg.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*") + "$");
	let dirents;
	try {
		dirents = fs.readdirSync(base, { withFileTypes: true });
	} catch {
		return [];
	}
	return dirents.filter((d) => d.isDirectory() && re.test(d.name)).map((d) => (base === "." ? d.name : `${base}/${d.name}`));
}

const raw = getInput("extra-packages").trim();
let entries = [];

if (!raw) {
	console.log("No extra_packages provided — no satellite packages to publish.");
} else if (raw[0] === "[" || raw[0] === "{") {
	// JSON form: explicit { name, dir } list (or a single object).
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.error(`::error::extra_packages looks like JSON but failed to parse: ${error.message}`);
		process.exit(1);
	}
	for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
		if (!entry || !entry.dir) {
			console.error("::error::Each extra_packages JSON entry needs a 'dir'");
			process.exit(1);
		}
		const dir = norm(entry.dir);
		const name = entry.name || readPkg(dir)?.name;
		if (!name) {
			console.error(`::error::No 'name' for dir '${dir}' (not given in JSON and no readable package.json)`);
			process.exit(1);
		}
		entries.push({ name, dir });
	}
} else {
	// Glob form: one or more whitespace-separated patterns.
	for (const pattern of raw.split(/\s+/).filter(Boolean)) {
		for (const dir of expandGlob(pattern)) {
			const pkg = readPkg(dir);
			if (pkg) entries.push(pkg);
			else console.log(`Skipping ${dir} (no readable package.json)`);
		}
	}
}

// De-duplicate by directory (a satellite matched by multiple patterns publishes once).
const seen = new Set();
entries = entries.filter((e) => (seen.has(e.dir) ? false : (seen.add(e.dir), true)));

// Fail fast on duplicate package names — two distinct directories resolving to the
// same name (or a repeated name in the JSON list) would publish/tag that package
// twice in the matrix, producing partial failures. Each satellite must be unique.
const names = entries.map((e) => e.name);
const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
if (dupes.length) {
	console.error(`::error::Duplicate satellite package name(s): ${dupes.join(", ")}. Each satellite directory must resolve to a unique package name.`);
	process.exit(1);
}

setOutput("matrix", JSON.stringify(entries));
setOutput("has-extras", entries.length > 0 ? "true" : "false");

console.log(`Discovered ${entries.length} satellite package(s):`);
for (const e of entries) console.log(`  ${e.name}  <-  ${e.dir}`);
