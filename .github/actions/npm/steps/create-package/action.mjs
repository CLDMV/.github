/**
 * @fileoverview Create a .tgz package via `npm pack` / `yarn pack` and report
 * its path. Node entrypoint for the create-package action.
 * @module @cldmv/.github.npm.steps.create-package
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const packageManager = getInput("package-manager", { default: "npm" });
	const packageName = getInput("package-name");

	console.log("📦 Creating npm package...");
	execSync(packageManager === "yarn" ? "yarn pack" : "npm pack", { stdio: "inherit" });

	// `ls *.tgz | head -1` — first .tgz in lexical order.
	const packageFile = fs
		.readdirSync(".")
		.filter((name) => name.endsWith(".tgz"))
		.sort()[0];
	if (!packageFile) {
		console.error("::error::No .tgz package file was created");
		process.exit(1);
	}
	console.log(`✅ Created package: ${packageFile}`);

	// Validate the package filename against the expected package name, if given.
	if (packageName) {
		const expectedPattern = packageName.replace(/@/g, "").replace(/\//g, "-");
		if (!packageFile.includes(expectedPattern)) {
			console.log("⚠️ Warning: Package filename doesn't match expected pattern");
			console.log(`Expected pattern: *${expectedPattern}*`);
			console.log(`Actual filename: ${packageFile}`);
		}
	}

	setOutput("package-path", path.resolve(packageFile));
	setOutput("package-filename", packageFile);

	console.log("📋 Package contents:");
	try {
		execSync(`tar -tzf "${packageFile}"`, { stdio: "inherit" });
	} catch {
		// Listing is best-effort only.
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
