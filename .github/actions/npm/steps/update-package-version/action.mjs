/**
 * @fileoverview Update the package.json version using the appropriate package
 * manager, skipping the write when it is already current. Node entrypoint for
 * the update-package-version action.
 * @module @cldmv/.github.npm.steps.update-package-version
 */

import fs from "node:fs";
import { getInput, exec } from "../../../common/common/core.mjs";

try {
	const newVersion = getInput("new-version", { required: true });
	const packageManager = getInput("package-manager", { default: "npm" });

	const currentVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

	if (currentVersion === newVersion) {
		console.log(`📝 Package.json already at version ${newVersion} - no update needed`);
	} else {
		console.log(`📝 Updating package.json from ${currentVersion} to ${newVersion}`);
		if (packageManager === "yarn") {
			exec(`yarn version --new-version "${newVersion}" --no-git-tag-version`);
		} else {
			exec(`npm version "${newVersion}" --no-git-tag-version`);
		}
		console.log(`📝 Updated package.json to version ${newVersion}`);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
