/**
 * @fileoverview Single source of truth for resolving which package manager a
 * repository uses, plus helpers to route arbitrary commands through it. Shared
 * by the detect-package-manager action and imported directly by the other npm
 * node actions so `auto` is resolved identically everywhere.
 * @module @cldmv/.github.npm.utilities.detect-package-manager.resolve
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Package managers this pipeline supports. */
export const SUPPORTED = ["npm", "yarn", "pnpm"];

/**
 * Resolve the package manager for a repository.
 *
 * An explicit `npm` / `yarn` / `pnpm` input is honored verbatim — detection is
 * skipped entirely. Anything else (the `auto` default, empty, or an unknown
 * value) triggers detection with this precedence:
 *   1. the `packageManager` field in package.json (the corepack standard, e.g.
 *      `pnpm@9.0.0`) — the PRIMARY signal, because workspace repos frequently
 *      commit no lockfile in-repo (it lives in the umbrella);
 *   2. lockfile / workspace signals — `pnpm-lock.yaml` or `pnpm-workspace.yaml`
 *      → pnpm; `yarn.lock` → yarn; `package-lock.json` or nothing → npm.
 * A repo with no pnpm/yarn signal always resolves to npm, so existing npm-only
 * repos are unaffected by the `auto` default.
 *
 * @public
 * @param {string} input - The requested value (`auto` | `npm` | `yarn` | `pnpm`).
 * @param {string} [cwd="."] - Directory to inspect for the signals.
 * @returns {"npm"|"yarn"|"pnpm"} The resolved package manager.
 */
export function resolvePackageManager(input, cwd = ".") {
	const explicit = String(input ?? "")
		.trim()
		.toLowerCase();
	if (SUPPORTED.includes(explicit)) return explicit;

	// (1) packageManager field (corepack standard) — primary signal.
	try {
		const pkgPath = join(cwd, "package.json");
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			const declared = String(pkg.packageManager ?? "")
				.trim()
				.toLowerCase()
				.split("@")[0];
			if (SUPPORTED.includes(declared)) return declared;
		}
	} catch {
		// A malformed package.json falls through to lockfile detection.
	}

	// (2) lockfile / workspace signals.
	if (existsSync(join(cwd, "pnpm-lock.yaml")) || existsSync(join(cwd, "pnpm-workspace.yaml"))) return "pnpm";
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn";

	// package-lock.json or no signal at all → npm (back-compat default).
	return "npm";
}

/**
 * Whether a `<pm>-lock.yaml` / lockfile that enables a frozen install exists.
 * @public
 * @param {"npm"|"yarn"|"pnpm"} pm
 * @param {string} [cwd="."]
 * @returns {boolean}
 */
export function hasLockfile(pm, cwd = ".") {
	if (pm === "pnpm") return existsSync(join(cwd, "pnpm-lock.yaml"));
	if (pm === "yarn") return existsSync(join(cwd, "yarn.lock"));
	return existsSync(join(cwd, "package-lock.json"));
}

/**
 * The install command for a package manager. A frozen/CI install is used only
 * when the matching lockfile is present; otherwise a plain install (workspace
 * repos often carry no in-repo lockfile).
 * @public
 * @param {"npm"|"yarn"|"pnpm"} pm
 * @param {boolean} frozen - Whether the matching lockfile exists.
 * @returns {string}
 */
export function installCommand(pm, frozen) {
	if (pm === "pnpm") return frozen ? "pnpm install --frozen-lockfile" : "pnpm install";
	if (pm === "yarn") return frozen ? "yarn install --frozen-lockfile" : "yarn install";
	return frozen ? "npm ci" : "npm install";
}

/**
 * Rewrite the leading `npm` / `npx` token of a command to the resolved package
 * manager. A no-op for npm (so npm repos are byte-for-byte unchanged) and for
 * commands that don't start with npm/npx (e.g. `make build`). Used at the exec
 * chokepoints so configurable command inputs default to the detected PM.
 *   `npm run build`  →  `pnpm run build`   (pnpm)
 *   `npx foo`        →  `pnpm dlx foo`     (pnpm) / `yarn dlx foo` (yarn)
 * @public
 * @param {"npm"|"yarn"|"pnpm"} pm
 * @param {string} command
 * @returns {string}
 */
export function pmCommand(pm, command) {
	const cmd = String(command ?? "").trim();
	if (!cmd || pm === "npm") return cmd;
	if (cmd === "npm") return pm;
	if (/^npm\s/.test(cmd)) return cmd.replace(/^npm(\s)/, `${pm}$1`);
	if (/^npx\s/.test(cmd)) {
		const dlx = pm === "yarn" ? "yarn dlx" : "pnpm dlx";
		return cmd.replace(/^npx(\s)/, `${dlx}$1`);
	}
	return cmd;
}
