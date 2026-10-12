/**
 * @fileoverview Classify a pending release range (`<base>..HEAD`) as "deps-only":
 * every changed file is a lockfile or CI configuration, or the root
 * `package.json` with ONLY `devDependencies` (and the release `version` field)
 * changed. Anything that could alter what a consumer installs or runs
 * (`dependencies`, `peerDependencies`, `optionalDependencies`, `files`,
 * `exports`, `bin`, `scripts`, shipped source, docs, ...) makes the range a
 * normal release. Decided generically by comparing manifest fields; no
 * `npm pack` needed.
 *
 * @module @cldmv/.github.git.steps.check-release-commit.deps-only
 */

import { execFileSync } from "node:child_process";

/** Lockfiles that do not ship (npm-shrinkwrap.json does ship, so it is deliberately absent). */
const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

/** The only manifest fields allowed to differ between base and head. */
const ALLOWED_MANIFEST_FIELDS = new Set(["devDependencies", "version"]);

/**
 * Whether a changed path is a lockfile or CI configuration.
 * @param {string} path - Repo-relative path.
 * @returns {boolean}
 */
export function isLockOrCiPath(path) {
	if (LOCKFILES.has(path)) return true;
	return path.startsWith(".github/");
}

/**
 * Whether two parsed manifests differ only in allowed (non-shipping) fields.
 * @param {object|null} base - package.json at the base ref (null if absent).
 * @param {object|null} head - package.json at the head ref (null if absent).
 * @returns {boolean} True when only `devDependencies`/`version` differ.
 */
export function manifestChangeIsDevOnly(base, head) {
	if (!base || !head || typeof base !== "object" || typeof head !== "object") return false;
	const keys = new Set([...Object.keys(base), ...Object.keys(head)]);
	for (const key of keys) {
		if (ALLOWED_MANIFEST_FIELDS.has(key)) continue;
		if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) return false;
	}
	return true;
}

/**
 * Pure classifier.
 * @param {object} args
 * @param {string[]} args.files - Paths changed in the range.
 * @param {object|null} args.baseManifest - Root package.json at base.
 * @param {object|null} args.headManifest - Root package.json at head.
 * @returns {boolean} True when the range is deps-only. An empty range is not.
 */
export function classifyDepsOnly({ files, baseManifest, headManifest }) {
	if (!files || files.length === 0) return false;
	for (const file of files) {
		if (file === "package.json") {
			if (!manifestChangeIsDevOnly(baseManifest, headManifest)) return false;
			continue;
		}
		if (!isLockOrCiPath(file)) return false;
	}
	return true;
}

function git(args) {
	return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readManifest(ref) {
	try {
		return JSON.parse(git(["show", `${ref}:package.json`]));
	} catch {
		return null;
	}
}

/**
 * Classify `<baseRef>..<headRef>` of the current checkout. Any git failure
 * (missing ref, shallow clone) yields false, so an unclassifiable range is
 * treated as a normal release.
 * @param {string} baseRef - Merge-base SHA / ref.
 * @param {string} [headRef="HEAD"]
 * @returns {boolean}
 */
export function classifyRange(baseRef, headRef = "HEAD") {
	if (!baseRef) return false;
	try {
		const files = git(["diff", "--name-only", "-z", `${baseRef}..${headRef}`])
			.split("\0")
			.filter(Boolean);
		return classifyDepsOnly({ files, baseManifest: readManifest(baseRef), headManifest: readManifest(headRef) });
	} catch (err) {
		console.log(`⚠️ deps-only classification failed (${err.message}) — treating as a normal release`);
		return false;
	}
}
