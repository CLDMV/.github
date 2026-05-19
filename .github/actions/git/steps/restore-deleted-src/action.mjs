/**
 * @fileoverview Restore src/ from HEAD when the build step deleted it, so the
 * deletion is excluded from the version-bump commit. Node entrypoint for the
 * restore-deleted-src action.
 * @module @cldmv/.github.git.steps.restore-deleted-src
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
		console.log("✅ src/ restored");
	} else {
		console.log("ℹ️ No src/ deletions detected — skipping restore");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
