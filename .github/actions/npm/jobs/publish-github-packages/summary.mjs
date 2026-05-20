/**
 * @fileoverview Write the GitHub Packages publishing step summary (start
 * banner + result), covering dry-run and real publishes. Node delegation step
 * of the publish-github-packages action.
 * @module @cldmv/.github.npm.jobs.publish-github-packages.summary
 */

import { appendSummary } from "../../../common/common/core.mjs";

const packageName = process.env.PACKAGE_NAME || "";
const version = process.env.VERSION || "";
const dryRun = process.env.DRY_RUN === "true";
const published = process.env.PUBLISHED === "true";
const command = process.env.COMMAND || "";
const repository = process.env.REPOSITORY || "";

appendSummary("## 📦 GitHub Packages Publishing Progress");
appendSummary(`- 🔄 Starting GitHub Packages publication for ${packageName}@${version}`);
appendSummary("");

const displayVersion = /^v/.test(version) ? version : `v${version}`;
const orgName = repository.split("/")[0];
const shortName = packageName.replace(/^@[^/]*\//, "");

if (published && !dryRun) {
	appendSummary(
		`- ✅ GitHub Packages: Published [${packageName} ${displayVersion}](https://github.com/${orgName}/${shortName}/pkgs/npm/${shortName})`
	);
} else if (published && dryRun) {
	appendSummary("- 🧪 **DRY RUN**: GitHub Packages validation successful");
	appendSummary("  - ✅ Package name and version are valid");
	appendSummary("  - ✅ GitHub token has proper permissions");
	appendSummary("  - ✅ Publish command generated successfully");
	appendSummary("  - ✅ All prerequisites met for GitHub Packages publication");
	appendSummary("");
	appendSummary(`💡 **Would publish**: \`${command}\` to registry \`https://npm.pkg.github.com\``);
} else if (!published && !dryRun) {
	appendSummary(`- ❌ GitHub Packages: Publication failed for ${packageName}@${version}`);
}
