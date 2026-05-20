/**
 * @fileoverview Install project dependencies with the appropriate package
 * manager. Node entrypoint for the install-dependencies action.
 *
 * Skips silently when package.json declares no dependencies / devDependencies
 * (e.g. metadata-only meta-packages like @cldmv/.github). Without the skip,
 * `npm ci` would fail looking for a non-existent package-lock.json.
 * @module @cldmv/.github.npm.steps.install-dependencies
 */

import { readFileSync, existsSync } from "node:fs";
import { getInput, exec } from "../../../common/common/core.mjs";

try {
	const packageManager = getInput("package-manager", { default: "npm" });

	// Detect metadata-only packages: no deps + no lockfile means there's
	// nothing to install. `npm ci` would fail here; gracefully skip.
	let hasDeps = false;
	if (existsSync("package.json")) {
		const pkg = JSON.parse(readFileSync("package.json", "utf8"));
		const depKeys = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
		hasDeps = depKeys.some((k) => pkg[k] && Object.keys(pkg[k]).length > 0);
	}
	const lockfile = packageManager === "yarn" ? "yarn.lock" : "package-lock.json";
	if (!hasDeps && !existsSync(lockfile)) {
		console.log(`::notice::No dependencies declared and no ${lockfile} present — skipping install.`);
		process.exit(0);
	}

	if (packageManager === "yarn") {
		exec("yarn install --frozen-lockfile");
	} else {
		exec("npm ci");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
