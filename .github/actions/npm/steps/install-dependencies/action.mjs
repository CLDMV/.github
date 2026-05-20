/**
 * @fileoverview Install project dependencies with the appropriate package
 * manager. Node entrypoint for the install-dependencies action.
 * @module @cldmv/.github.npm.steps.install-dependencies
 */

import { getInput, exec } from "../../../common/common/core.mjs";

try {
	const packageManager = getInput("package-manager", { default: "npm" });
	if (packageManager === "yarn") {
		exec("yarn install --frozen-lockfile");
	} else {
		exec("npm ci");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
