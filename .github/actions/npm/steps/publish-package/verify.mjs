/**
 * @fileoverview Verify that the downloaded build artifact contains a usable
 * package-contents directory before publishing. Pre-publish step of the
 * publish-package action.
 * @module @cldmv/.github.npm.steps.publish-package.verify
 */

import fs from "node:fs";

// Directory within the downloaded artifact to publish from. Defaults to
// package-contents (the core package); satellites pass their own staged dir.
const packageDir = process.env.PACKAGE_DIR || "package-contents";

console.log(`📦 Verifying package contents from artifacts (${packageDir})...`);

if (fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory()) {
	console.log(`✅ Package contents directory found in artifacts: ${packageDir}`);
	console.log(`📋 Files in ${packageDir}:`);
	for (const name of fs.readdirSync(packageDir)) console.log(`  ${name}`);

	if (!fs.existsSync(`${packageDir}/package.json`)) {
		console.error(`::error::No package.json found in ${packageDir}`);
		process.exit(1);
	}
} else {
	console.error(`::error::Package contents directory not found in artifacts: ${packageDir}`);
	console.log("Available files:");
	for (const name of fs.readdirSync(".")) console.log(`  ${name}`);
	process.exit(1);
}
