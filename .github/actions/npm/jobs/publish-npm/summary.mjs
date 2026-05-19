/**
 * @fileoverview Write the NPM publishing step summary (start banner + result),
 * covering dry-run and real publishes. Node delegation step of the publish-npm
 * action.
 * @module @cldmv/.github.npm.jobs.publish-npm.summary
 */

import { appendSummary } from "../../../common/common/core.mjs";

const packageName = process.env.PACKAGE_NAME || "";
const version = process.env.VERSION || "";
const dryRun = process.env.DRY_RUN === "true";
const published = process.env.PUBLISHED === "true";
const command = process.env.COMMAND || "";

if (dryRun) {
	appendSummary("## 🧪 Dry Run - NPM Publishing Validation");
	appendSummary(`- 🔍 Validating NPM publication for ${packageName}@${version} (NO PUBLISHING WILL OCCUR)`);
} else {
	appendSummary("## 📦 NPM Publishing Progress");
	appendSummary(`- 🔄 Starting NPM publication for ${packageName}@${version}`);
}
appendSummary("");

const displayVersion = /^v/.test(version) ? version : `v${version}`;

if (published && !dryRun) {
	appendSummary(`- ✅ NPM Registry: Published [${packageName} ${displayVersion}](https://www.npmjs.com/package/${packageName})`);
} else if (published && dryRun) {
	appendSummary("- 🧪 **DRY RUN**: NPM Registry validation successful");
	appendSummary("  - ✅ Package name and version are valid");
	appendSummary("  - ✅ Authentication token is valid");
	appendSummary("  - ✅ Publish command generated successfully");
	appendSummary("  - ✅ All prerequisites met for NPM publication");
	appendSummary("");
	appendSummary(`💡 **Would publish**: \`${command}\``);
} else if (!published && !dryRun) {
	appendSummary(`- ❌ NPM Registry: Publication failed for ${packageName}@${version}`);
}
