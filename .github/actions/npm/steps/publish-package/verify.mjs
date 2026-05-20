/**
 * @fileoverview Verify that the downloaded build artifact contains a usable
 * package-contents directory before publishing. Pre-publish step of the
 * publish-package action.
 * @module @cldmv/.github.npm.steps.publish-package.verify
 */

import fs from "node:fs";

console.log("📦 Verifying package contents from artifacts...");

if (fs.existsSync("package-contents") && fs.statSync("package-contents").isDirectory()) {
	console.log("✅ Package contents directory found in artifacts");
	console.log("📋 Files in package-contents:");
	for (const name of fs.readdirSync("package-contents")) console.log(`  ${name}`);

	if (!fs.existsSync("package-contents/package.json")) {
		console.error("::error::No package.json found in package-contents");
		process.exit(1);
	}
} else {
	console.error("::error::Package contents directory not found in artifacts");
	console.log("Available files:");
	for (const name of fs.readdirSync(".")) console.log(`  ${name}`);
	process.exit(1);
}
