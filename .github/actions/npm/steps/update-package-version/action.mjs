/**
 * @fileoverview Update the package.json version using the appropriate package
 * manager, skipping the write when it is already current. Node entrypoint for
 * the update-package-version action.
 * @module @cldmv/.github.npm.steps.update-package-version
 */

import fs from "node:fs";
import { getInput, exec } from "../../../common/common/core.mjs";
import { resolvePackageManager } from "../../utilities/detect-package-manager/resolve.mjs";

try {
	const newVersion = getInput("new-version", { required: true });
	const pm = resolvePackageManager(getInput("package-manager", { default: "auto" }), ".");

	const currentVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

	if (currentVersion === newVersion) {
		console.log(`📝 Package.json already at version ${newVersion} - no update needed`);
	} else {
		console.log(`📝 Updating package.json from ${currentVersion} to ${newVersion}`);
		// Provision pnpm/yarn via corepack (bundled with Node — no third-party action).
		if (pm !== "npm") {
			try {
				exec("corepack enable");
			} catch (error) {
				console.log(`::warning::corepack enable failed (${error.message}); assuming ${pm} is already on PATH.`);
			}
		}
		if (pm === "yarn") {
			exec(`yarn version --new-version "${newVersion}" --no-git-tag-version`);
		} else if (pm === "pnpm") {
			exec(`pnpm version "${newVersion}" --no-git-tag-version`);
		} else {
			exec(`npm version "${newVersion}" --no-git-tag-version`);
		}
		console.log(`📝 Updated package.json to version ${newVersion}`);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
