/**
 * @fileoverview Restore src/ if the build step deleted it, so that deletion is
 * not captured in the version-bump commit. Node delegation step of the
 * create-release-pr action.
 * @module @cldmv/.github.github.jobs.create-release-pr.restore-src
 */

import { execSync } from "node:child_process";

try {
	let deleted = "";
	try {
		deleted = execSync("git ls-files --deleted -- src/", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
	} catch {
		deleted = "";
	}

	if (deleted) {
		console.log("🔄 Restoring src/ deleted by build step...");
		execSync("git checkout HEAD -- src/", { stdio: "inherit" });
		console.log("✅ src/ restored — only dist/, types/, and package files will be committed");
	} else {
		console.log("ℹ️ No src/ deletions detected — skipping restore");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
