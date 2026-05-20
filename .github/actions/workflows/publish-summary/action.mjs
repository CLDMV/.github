/**
 * @fileoverview Render the publish workflow job summary. Node entrypoint for
 * the publish-summary action.
 * @module @cldmv/.github.workflows.publish-summary
 */

import { getInput, getBooleanInput, appendSummary } from "../../common/common/core.mjs";

const dryRun = getBooleanInput("dry-run");
const packageName = getInput("package-name", { required: true });
const version = getInput("version");
const publishResult = getInput("publish-result");

appendSummary(dryRun ? "## 🧪 Dry Run - Publish Workflow Validation" : "## 📦 Publish Workflow Summary");
appendSummary("");
appendSummary(`**Package**: \`${packageName}\``);
appendSummary(`**Version**: \`${version}\``);
appendSummary("");

if (publishResult === "success") {
	if (dryRun) {
		appendSummary("✅ **Overall Status**: Dry run validation successful");
		appendSummary("");
		appendSummary("🧪 **Dry Run Complete**: All validations passed! No publishing or releases were created.");
		appendSummary("");
		appendSummary("### ✅ Validation Results:");
		appendSummary("- Build and tests passed");
		appendSummary("- Package configuration is valid");
		appendSummary("- NPM authentication and commands validated");
		appendSummary("- GitHub Packages authentication and commands validated");
		appendSummary("- Release creation prerequisites verified");
		appendSummary("");
		appendSummary("🚀 **Ready to Publish**: Re-run with `dry_run: false` to execute the actual publishing.");
	} else {
		appendSummary("✅ **Overall Status**: Publishing workflow completed successfully");
		appendSummary("");
		appendSummary("Check the detailed progress above for specific publishing results to each registry.");
	}
} else {
	appendSummary("❌ **Overall Status**: Publishing workflow failed");
	appendSummary("");
	appendSummary("Check the detailed progress above and workflow logs for specific failure details.");
}
