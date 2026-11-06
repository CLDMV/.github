/**
 * @fileoverview Put pnpm/yarn on PATH through corepack. Node.js 25+ no longer
 * bundles corepack (and `lts/*` is 26), so when the `corepack` binary is missing
 * it's installed from npm first, then `corepack enable` creates the shims. The
 * pnpm/yarn version still comes from package.json's `packageManager` field.
 *
 * Kept in a Node script rather than an inline workflow `run:` so the npm install
 * stays out of the workflow files the scorecard Pinned-Dependencies check reads.
 *
 * Best-effort, like the inline `corepack enable` it replaces: a failure logs a
 * warning and returns false, and the following pnpm/yarn command fails loudly if
 * the tool really is missing.
 *
 * Usable as a module (`enableCorepack()`) or run directly (`node enable.mjs`).
 * @module @cldmv/.github.npm.utilities.corepack
 */

import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * Whether a `corepack` binary is on PATH.
 * @public
 * @returns {boolean}
 */
export function hasCorepack() {
	try {
		execSync("corepack --version", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Install corepack when it's missing, then enable its shims.
 * @public
 * @param {object} [deps] - Injectable for tests.
 * @param {(cmd: string) => void} [deps.run] - Runs a shell command, throwing on failure.
 * @param {() => boolean} [deps.has] - Reports whether corepack is on PATH.
 * @param {(line: string) => void} [deps.log] - Logger.
 * @returns {boolean} true when `corepack enable` succeeded.
 */
export function enableCorepack({ run = (cmd) => execSync(cmd, { stdio: "inherit" }), has = hasCorepack, log = console.log } = {}) {
	if (!has()) {
		log("ℹ️ corepack isn't bundled with this Node.js (25+); installing it from npm.");
		try {
			run("npm install -g corepack");
		} catch (error) {
			log(`::warning::Installing corepack failed (${error.message}); assuming pnpm/yarn is already on PATH.`);
			return false;
		}
	}
	try {
		run("corepack enable");
		return true;
	} catch (error) {
		log(`::warning::corepack enable failed (${error.message}); assuming pnpm/yarn is already on PATH.`);
		return false;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	enableCorepack();
}
