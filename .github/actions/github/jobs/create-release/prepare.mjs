/**
 * @fileoverview Write the release start banner and resolve the version and
 * commit SHA for the release. Node delegation step of the create-release action.
 * @module @cldmv/.github.github.jobs.create-release.prepare
 */

import fs from "node:fs";
import { execSync } from "node:child_process";
import { appendSummary, setOutput } from "../../../common/common/core.mjs";

try {
	const dryRun = process.env.DRY_RUN === "true";
	const packageName = process.env.PACKAGE_NAME || "";
	const inputVersion = (process.env.INPUT_VERSION || "").trim();

	if (dryRun) {
		appendSummary("## 🧪 Dry Run - GitHub Release Validation");
		appendSummary(`- 🔍 Validating GitHub release creation for ${packageName} (NO RELEASE WILL BE CREATED)`);
	} else {
		appendSummary("## 🚀 GitHub Release Progress");
		appendSummary(`- 🔄 Starting release creation for ${packageName}`);
	}
	appendSummary("");

	let version = inputVersion;
	if (!version) {
		version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
		console.log(`🔍 Auto-detected version from package.json: ${version}`);
	} else {
		console.log(`📋 Using provided version: ${version}`);
	}
	setOutput("version", version);

	setOutput("commit-sha", execSync("git rev-parse HEAD").toString().trim());
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
