/**
 * @fileoverview Determine the version to publish from package.json (or an
 * override), and report the latest published NPM version plus a suggested
 * next version. Node entrypoint for the npm extract-version action.
 * @module @cldmv/.github.npm.steps.extract-version
 */

import fs from "node:fs";
import { execSync } from "node:child_process";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const packageName = getInput("package-name", { required: true });
	const versionOverride = getInput("version-override");

	console.log(`📋 Extracting version for package: ${packageName}`);

	if (!fs.existsSync("package.json")) {
		console.error("::error::package.json not found");
		process.exit(1);
	}
	const packageJsonVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
	console.log(`📦 package.json version: ${packageJsonVersion}`);
	setOutput("package-json-version", packageJsonVersion);

	// Look up the latest published version for reference (absent on first publish).
	console.log("🔍 Checking NPM registry for latest version...");
	let npmLatestVersion = "";
	try {
		npmLatestVersion = execSync(`npm view "${packageName}" version`, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
		console.log(`📊 NPM latest version: ${npmLatestVersion}`);
	} catch {
		console.log("📊 Package not found on NPM (first publish)");
	}
	setOutput("npm-latest-version", npmLatestVersion);

	const targetVersion = versionOverride || packageJsonVersion;
	console.log(versionOverride ? `🎯 Using override version: ${targetVersion}` : `🎯 Using package.json version: ${targetVersion}`);

	if (npmLatestVersion) {
		const [major, minor, patch] = npmLatestVersion.split(".").map(Number);
		const suggestedVersion = `${major}.${minor}.${patch + 1}`;
		setOutput("suggested-version", suggestedVersion);
		console.log(`💡 Suggested next version (if needed): ${suggestedVersion}`);
	} else {
		setOutput("suggested-version", "");
	}

	setOutput("version", targetVersion);
	console.log(`✅ Will attempt to publish version: ${targetVersion}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
