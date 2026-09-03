/**
 * @fileoverview Install project dependencies with the resolved package manager
 * (npm, yarn, or pnpm). Node entrypoint for the install-dependencies action.
 *
 * Skips silently when package.json declares no dependencies / devDependencies
 * and there is no lockfile / workspace manifest (e.g. metadata-only meta-packages
 * like @cldmv/.github). Without the skip, `npm ci` / `pnpm install --frozen`
 * would fail looking for a non-existent lockfile.
 * @module @cldmv/.github.npm.steps.install-dependencies
 */

import { readFileSync, existsSync } from "node:fs";
import { getInput, exec } from "../../../common/common/core.mjs";
import { resolvePackageManager, hasLockfile, installCommand } from "../../utilities/detect-package-manager/resolve.mjs";

try {
	const pm = resolvePackageManager(getInput("package-manager", { default: "auto" }), ".");

	// Detect metadata-only packages: no deps + no lockfile + no workspace means
	// there's nothing to install. A frozen install would fail here; gracefully skip.
	let hasDeps = false;
	if (existsSync("package.json")) {
		const pkg = JSON.parse(readFileSync("package.json", "utf8"));
		const depKeys = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
		hasDeps = depKeys.some((k) => pkg[k] && Object.keys(pkg[k]).length > 0);
	}
	const lockfilePresent = hasLockfile(pm, ".");
	// A pnpm workspace manifest means there is something to install even with no
	// in-repo lockfile (deps resolve through the workspace).
	const pnpmWorkspace = pm === "pnpm" && existsSync("pnpm-workspace.yaml");
	if (!hasDeps && !lockfilePresent && !pnpmWorkspace) {
		console.log(`::notice::No dependencies declared and no ${pm} lockfile present — skipping install.`);
		process.exit(0);
	}

	// Provision pnpm/yarn via corepack (bundled with Node — no third-party action,
	// which keeps the scorecard Pinned-Dependencies check green). The version comes
	// from package.json's packageManager field when present. npm needs no shim.
	if (pm !== "npm") {
		try {
			exec("corepack enable");
		} catch (error) {
			console.log(`::warning::corepack enable failed (${error.message}); assuming ${pm} is already on PATH.`);
		}
	}

	const cmd = installCommand(pm, lockfilePresent);
	console.log(`📦 Installing dependencies with: ${cmd}`);
	exec(cmd);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
