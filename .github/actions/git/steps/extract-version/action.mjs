/**
 * @fileoverview Extract a release version from a pull request title, falling
 * back to a "release" label. Node entrypoint for the git extract-version action.
 * @module @cldmv/.github.git.steps.extract-version
 */

import { getEventPayload, setOutput, setOutputs } from "../../../common/common/core.mjs";

try {
	const pr = getEventPayload().pull_request || {};
	const prTitle = pr.title || "";
	// `contains(labels.*.name, 'release')` in Actions == case-insensitive membership.
	const hasReleaseLabel = (pr.labels || []).some((label) => String(label?.name || "").toLowerCase() === "release");

	console.log(`PR Title: ${prTitle}`);
	console.log(`Has release label: ${hasReleaseLabel}`);

	const titleVersion = prTitle.match(/^release: v(\d+\.\d+\.\d+)/);
	if (titleVersion) {
		setOutputs({ "should-release": "true", version: titleVersion[1], "is-prerelease": "false" });
		console.log(`🚀 Release PR merged for version ${titleVersion[1]} (from title)`);
	} else if (hasReleaseLabel) {
		// Release label present — try to pull a version out of the title anyway.
		const anyVersion = prTitle.match(/v(\d+\.\d+\.\d+)/);
		if (anyVersion) {
			setOutputs({ "should-release": "true", version: anyVersion[1], "is-prerelease": "false" });
			console.log(`🚀 Release PR merged for version ${anyVersion[1]} (from label + title)`);
		} else {
			setOutput("should-release", "false");
			console.log(`❌ Release label found but could not extract version from title: ${prTitle}`);
		}
	} else {
		setOutput("should-release", "false");
		console.log("ℹ️ Not a release PR (title doesn't start with 'release:' and no release label)");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
