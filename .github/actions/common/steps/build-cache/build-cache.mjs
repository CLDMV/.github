/**
 * @fileoverview Key planning for the build-cache action: turn the caller's
 * `build_cache_paths` / `build_cache_key_files` inputs into an actions/cache
 * key, and decide whether this run may save the cache.
 *
 * The key is `<os>-<arch>-cldmv-build-<sha256>`, where the hash covers the
 * build command, the cached paths, and the path + content hash of every file
 * the key globs match. GitHub's `hashFiles()` takes comma-separated pattern
 * arguments and can't be fed a multiline input reliably, so the files are
 * matched and hashed here instead. Only Node built-ins are used, and nothing
 * newer than Node 16, because the composite runs this on whatever Node the job
 * set up (matrix legs can be older than the runner's bundled node24).
 *
 * Glob syntax per line: `*` (within a segment), `**` (any depth), `?`, `{a,b}`;
 * a leading `!` excludes; `#` starts a comment line. A pattern that matches a
 * directory covers every file under it. `.git` is never walked, and
 * `node_modules` only when the pattern itself names it.
 * @module @cldmv/.github.common.steps.build-cache
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Prefix that namespaces these entries among a repo's other caches. */
export const KEY_PREFIX = "cldmv-build";

/** Bumped when the hash layout changes, so old entries stop matching. */
const HASH_VERSION = "1";

/** Branches (besides the default branch) whose push runs may save. */
const SAVE_BRANCHES = ["next", "hotfixes"];

/**
 * Split a multiline input into its entries: trimmed, blank and `#` lines dropped.
 * @param {string} value - Raw multiline input.
 * @returns {string[]} The entries in order.
 */
export function parseList(value) {
	return String(value || "")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

/**
 * Normalize a glob or path: forward slashes, no leading `./`, no trailing `/`.
 * @param {string} pattern - Pattern as written by the caller.
 * @returns {string} The normalized pattern.
 */
function normalizePattern(pattern) {
	let p = pattern.replace(/\\/g, "/");
	while (p.startsWith("./")) p = p.slice(2);
	return p.replace(/\/+$/, "");
}

/**
 * Convert a glob to an anchored RegExp over repo-relative, `/`-separated paths.
 * @param {string} pattern - Normalized glob.
 * @returns {RegExp} The matcher.
 */
export function globToRegExp(pattern) {
	let re = "^";
	let braceDepth = 0;
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === "*" && pattern[i + 1] === "*") {
			i++;
			if (pattern[i + 1] === "/") {
				// `**/` matches zero or more whole directories.
				re += "(?:.*/)?";
				i++;
			} else {
				re += ".*";
			}
		} else if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else if (c === "{") {
			braceDepth++;
			re += "(?:";
		} else if (c === "}" && braceDepth > 0) {
			braceDepth--;
			re += ")";
		} else if (c === "," && braceDepth > 0) re += "|";
		else if (".\\+()|^$[]{}".includes(c)) re += "\\" + c;
		else re += c;
	}
	return new RegExp(re + "$");
}

/**
 * The leading path segments of a glob that contain no glob characters: the
 * directory the walk starts from.
 * @param {string} pattern - Normalized glob.
 * @returns {string} Base directory ("" = repo root).
 */
export function literalBase(pattern) {
	const segments = pattern.split("/");
	const base = [];
	for (const segment of segments) {
		if (/[*?{]/.test(segment)) break;
		base.push(segment);
	}
	// A fully literal pattern is a file or directory; walk from its parent.
	if (base.length === segments.length) base.pop();
	return base.join("/");
}

/**
 * Whether a path, or one of its parent directories, matches a glob. A match on
 * a directory covers everything under it.
 * @param {string} rel - Repo-relative file path.
 * @param {RegExp} re - Matcher from globToRegExp.
 * @returns {boolean}
 */
function matchesSelfOrParent(rel, re) {
	if (re.test(rel)) return true;
	let idx = rel.lastIndexOf("/");
	while (idx > 0) {
		if (re.test(rel.slice(0, idx))) return true;
		idx = rel.lastIndexOf("/", idx - 1);
	}
	return false;
}

/**
 * List every file under `dir` (repo-relative), without following directory
 * symlinks. `.git` is skipped; `node_modules` too unless `allowNodeModules`.
 * @param {string} root - Repo root.
 * @param {string} dir - Repo-relative start directory.
 * @param {boolean} allowNodeModules - Walk into node_modules.
 * @param {Set<string>} out - Collected paths.
 * @returns {void}
 */
function walk(root, dir, allowNodeModules, out) {
	let entries;
	try {
		entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const rel = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (entry.name === ".git") continue;
			if (entry.name === "node_modules" && !allowNodeModules) continue;
			walk(root, rel, allowNodeModules, out);
		} else if (entry.isFile() || entry.isSymbolicLink()) {
			out.add(rel);
		}
	}
}

/**
 * Resolve the key globs to a sorted list of repo-relative files.
 * @param {string} root - Repo root.
 * @param {string[]} patterns - Key-file globs (`!` = exclude).
 * @returns {string[]} Matching files, sorted.
 */
export function matchKeyFiles(root, patterns) {
	const includes = [];
	const excludes = [];
	for (const raw of patterns) {
		if (raw.startsWith("!")) excludes.push(globToRegExp(normalizePattern(raw.slice(1).trim())));
		else includes.push(normalizePattern(raw));
	}

	const matched = new Set();
	for (const pattern of includes) {
		if (!pattern) continue;
		const allowNodeModules = pattern.split("/").includes("node_modules");
		if (!/[*?{]/.test(pattern)) {
			// Literal path: the file itself, or every file under the directory.
			let stat;
			try {
				stat = fs.lstatSync(path.join(root, pattern));
			} catch {
				continue;
			}
			if (stat.isDirectory()) walk(root, pattern, allowNodeModules, matched);
			else matched.add(pattern);
			continue;
		}
		const re = globToRegExp(pattern);
		const base = literalBase(pattern);
		const candidates = new Set();
		walk(root, base, allowNodeModules, candidates);
		for (const rel of candidates) {
			if (matchesSelfOrParent(rel, re)) matched.add(rel);
		}
	}

	return [...matched].filter((rel) => !excludes.some((re) => matchesSelfOrParent(rel, re))).sort();
}

/**
 * SHA-256 of one file's content (a symlink hashes its target path).
 * @param {string} abs - Absolute path.
 * @returns {string} Hex digest.
 */
function hashFile(abs) {
	const hash = crypto.createHash("sha256");
	// Try readlink first instead of lstat-then-read, so there is no check/use gap:
	// it throws EINVAL for anything that isn't a symlink, which then gets read as a file.
	let target;
	try {
		target = fs.readlinkSync(abs);
	} catch (error) {
		if (error.code !== "EINVAL") throw error;
	}
	hash.update(target === undefined ? fs.readFileSync(abs) : `symlink:${target}`);
	return hash.digest("hex");
}

/**
 * Build the cache key.
 * @param {object} opts - Key inputs.
 * @param {string} opts.os - runner.os.
 * @param {string} opts.arch - runner.arch.
 * @param {string} opts.buildCommand - The build command the cache sits around.
 * @param {string[]} opts.paths - Cached paths.
 * @param {Array<[string, string]>} opts.files - [relative path, content hash] pairs, sorted.
 * @returns {string} The key.
 */
export function computeKey({ os, arch, buildCommand, paths, files }) {
	const hash = crypto.createHash("sha256");
	hash.update(`v${HASH_VERSION}\n`);
	hash.update(`command:${buildCommand}\n`);
	for (const p of paths) hash.update(`path:${p}\n`);
	for (const [rel, digest] of files) hash.update(`file:${rel}\0${digest}\n`);
	const parts = [os || "unknown", arch || "unknown", KEY_PREFIX, hash.digest("hex")];
	return parts.join("-").toLowerCase();
}

/**
 * Whether this run may save the cache: a push to the default branch, `next`
 * or `hotfixes`. PR and feature-branch runs only restore, so their entries
 * don't pile up in the repo's cache quota.
 * @param {object} ctx - Run context.
 * @param {string} ctx.eventName - GITHUB_EVENT_NAME.
 * @param {string} ctx.ref - GITHUB_REF.
 * @param {string} ctx.defaultBranch - The repository's default branch.
 * @returns {boolean}
 */
export function shouldSave({ eventName, ref, defaultBranch }) {
	if (eventName !== "push") return false;
	const branches = [...SAVE_BRANCHES];
	if (defaultBranch) branches.push(defaultBranch);
	return branches.some((branch) => ref === `refs/heads/${branch}`);
}

/**
 * Plan the cache for the current run.
 * @param {object} opts - Plan inputs.
 * @param {string} opts.root - Repo root.
 * @param {string} opts.paths - Multiline `build_cache_paths`.
 * @param {string} opts.keyFiles - Multiline `build_cache_key_files`.
 * @param {string} opts.buildCommand - Build command.
 * @param {string} opts.os - runner.os.
 * @param {string} opts.arch - runner.arch.
 * @param {string} opts.eventName - GITHUB_EVENT_NAME.
 * @param {string} opts.ref - GITHUB_REF.
 * @param {string} opts.defaultBranch - The repository's default branch.
 * @returns {{enabled: boolean, key: string, save: boolean, files: string[], paths: string[]}}
 */
export function plan({ root, paths, keyFiles, buildCommand, os, arch, eventName, ref, defaultBranch }) {
	const pathList = parseList(paths);
	if (pathList.length === 0) return { enabled: false, key: "", save: false, files: [], paths: [] };

	const files = matchKeyFiles(root, parseList(keyFiles));
	const hashed = files.map((rel) => [rel, hashFile(path.join(root, rel))]);
	const key = computeKey({ os, arch, buildCommand: String(buildCommand || "").trim(), paths: pathList, files: hashed });
	return { enabled: true, key, save: shouldSave({ eventName, ref, defaultBranch }), files, paths: pathList };
}
