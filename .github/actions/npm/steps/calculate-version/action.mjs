/**
 * @fileoverview Calculate the next version from package.json (or an explicit
 * base) and a bump type. Node entrypoint for the calculate-version action.
 * @module @cldmv/.github.npm.steps.calculate-version
 */

import fs from "node:fs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const currentVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
	setOutput("current-version", currentVersion);

	// A provided base-version overrides package.json so re-runs are idempotent:
	// it avoids double-bumping when the branch already has a "chore: bump version" commit.
	let calcBase = currentVersion;
	const baseVersion = getInput("base-version");
	if (baseVersion) {
		console.log(`📦 Using provided base version for bump calculation: ${baseVersion} (package.json is ${currentVersion})`);
		calcBase = baseVersion;
	}

	const [major, minor, patch] = calcBase.split(".").map(Number);
	const bumpType = getInput("version-bump", { required: true });
	const explicitVersion = getInput("explicit-version");

	let newVersion;
	if (bumpType === "explicit") {
		if (!explicitVersion) {
			console.error("::error::explicit version-bump specified but no explicit-version provided");
			process.exit(1);
		}
		newVersion = explicitVersion;
		console.log(`🏷️ Using explicit version: ${calcBase} → ${newVersion} (explicit)`);
	} else if (bumpType === "major") {
		newVersion = `${major + 1}.0.0`;
		console.log(`🏷️ Version bump: ${calcBase} → ${newVersion} (major)`);
	} else if (bumpType === "minor") {
		newVersion = `${major}.${minor + 1}.0`;
		console.log(`🏷️ Version bump: ${calcBase} → ${newVersion} (minor)`);
	} else {
		newVersion = `${major}.${minor}.${patch + 1}`;
		console.log(`🏷️ Version bump: ${calcBase} → ${newVersion} (patch)`);
	}

	setOutput("new-version", newVersion);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
