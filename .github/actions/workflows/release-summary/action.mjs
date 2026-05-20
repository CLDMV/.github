/**
 * @fileoverview Render the release workflow job summary, covering the
 * existing-PR-update path, the new-release path, and the no-release path.
 * Node entrypoint for the release-summary action.
 * @module @cldmv/.github.workflows.release-summary
 */

import { getInput, getBooleanInput, appendSummary } from "../../common/common/core.mjs";

const dryRun = getBooleanInput("dry-run");
const packageName = getInput("package-name", { required: true });
const updatePrResult = getInput("update-existing-pr-result");
const existingPrNumber = getInput("existing-pr-number");
const shouldRelease = getInput("should-release");
const releaseResult = getInput("release-result");
const prCreated = getInput("release-pr-created");
const newVersion = getInput("release-new-version");
const releasePrNumber = getInput("release-pr-number");
const serverUrl = getInput("server-url", { default: "https://github.com" });
const repository = getInput("repository", { required: true });

appendSummary(dryRun ? "## 🧪 Dry Run - Release Workflow Validation" : "## 🚀 Release Workflow Summary");
appendSummary("");
appendSummary(`**Package**: \`${packageName}\``);
appendSummary("");

if (updatePrResult === "success") {
	const prUrl = `${serverUrl}/${repository}/pull/${existingPrNumber}`;
	appendSummary("✅ **Overall Status**: Existing release PR updated successfully");
	appendSummary("");
	appendSummary(`**PR Number**: [#${existingPrNumber}](${prUrl})`);
	appendSummary("");
	appendSummary("📝 **Updated**: The PR description has been updated with the latest commits and changelog.");
	appendSummary("");
	appendSummary("🔄 **Next Steps**: Review the updated PR and merge when ready to publish the package.");
} else if (shouldRelease !== "true") {
	appendSummary("ℹ️ **Overall Status**: No release needed");
	appendSummary("");
	appendSummary("This commit was not detected as a release trigger.");
	appendSummary("");
	appendSummary(
		"**Automatic release detection:** The workflow detects conventional commits (`feat:`, `fix:`, breaking changes) and creates release PRs automatically."
	);
	appendSummary("");
	appendSummary("**Manual release:** Use `release:` or `release!:` prefix to explicitly trigger releases with custom versioning.");
} else if (releaseResult === "success") {
	if (prCreated === "true") {
		if (dryRun) {
			appendSummary("✅ **Overall Status**: Dry run validation successful");
			appendSummary("");
			appendSummary(`**New Version**: \`${newVersion}\``);
			appendSummary("");
			appendSummary("🧪 **Dry Run Complete**: All validations passed! No changes were made.");
			appendSummary("");
			appendSummary("### ✅ Validation Results:");
			appendSummary("- Release commit detected successfully");
			appendSummary("- Version calculation completed");
			appendSummary("- Build and tests passed");
			appendSummary("- Changelog generation successful");
			appendSummary("- All prerequisites met for release PR creation");
			appendSummary("");
			appendSummary("🚀 **Ready to Release**: Re-run with `dry_run: false` to create the actual release PR.");
		} else {
			const prUrl = `${serverUrl}/${repository}/pull/${releasePrNumber}`;
			appendSummary("✅ **Overall Status**: Release PR created successfully");
			appendSummary("");
			appendSummary(`**New Version**: \`${newVersion}\``);
			appendSummary(`**PR Number**: [#${releasePrNumber}](${prUrl})`);
			appendSummary("");
			appendSummary("🔄 **Next Steps**: Review and merge the release PR to publish the package.");
		}
	} else {
		appendSummary("ℹ️ **Overall Status**: No release PR created");
		appendSummary("");
		appendSummary("Release was detected but no PR was created.");
	}
} else {
	appendSummary("❌ **Overall Status**: Release workflow failed");
	appendSummary("");
	appendSummary("Check the detailed progress above and workflow logs for specific failure details.");
}
