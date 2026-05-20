/**
 * @fileoverview Write the closing create-release step summary. Node delegation
 * step of the create-release action.
 * @module @cldmv/.github.github.jobs.create-release.summary
 */

import { appendSummary } from "../../../common/common/core.mjs";

const dryRun = process.env.DRY_RUN === "true";
const version = process.env.VERSION;
const sourceOnly = process.env.RELEASE_SOURCE_ONLY === "true";
const releaseId = process.env.RELEASE_ID || "";
const releaseUrl = `${process.env.SERVER_URL}/${process.env.REPOSITORY}/releases/tag/v${version}`;

if (!dryRun) {
	appendSummary(`- ✅ Git tag v${version} created`);
	if (releaseId) {
		appendSummary(`- ✅ GitHub Release [v${version}](${releaseUrl}) created successfully`);
		if (!sourceOnly) appendSummary("- ✅ Package assets (.tar.gz and .zip) attached to release");
	}
}

appendSummary("");
appendSummary(`🎉 **GitHub Release Complete** - [Release v${version} is now available →](${releaseUrl})`);
