/**
 * @fileoverview Render the Continuous Integration workflow job summary. Node
 * entrypoint for the ci-summary action.
 * @module @cldmv/.github.workflows.ci-summary
 */

import { getInput, getBooleanInput, appendSummary } from "../../common/common/core.mjs";

const packageName = getInput("package-name", { required: true });
const nodeVersion = getInput("node-version", { default: "lts/*" });
const packageManager = getInput("package-manager", { default: "npm" });
const ciResult = getInput("ci-result");
const enableCoverageBadge = getBooleanInput("enable-coverage-badge");
const badgesBranch = getInput("badges-branch", { default: "badges" });
const coverageBadgeResult = getInput("coverage-badge-result");
const enablePrComment = getBooleanInput("enable-coverage-pr-comment");
const prCommentResult = getInput("coverage-pr-comment-result");

appendSummary("## 🏗️ Continuous Integration Summary");
appendSummary("");
appendSummary(`**Package**: \`${packageName}\``);
appendSummary(`**Node Version**: \`${nodeVersion}\``);
appendSummary(`**Package Manager**: \`${packageManager}\``);
appendSummary("");

if (ciResult === "success") {
	appendSummary("✅ **Overall Status**: All CI checks passed successfully");
} else {
	appendSummary("❌ **Overall Status**: CI workflow failed");
	appendSummary("");
	appendSummary("Check the detailed progress above and workflow logs for specific failure details.");
}

if (enableCoverageBadge) {
	appendSummary("");
	appendSummary("### 📊 Coverage Badge");
	if (coverageBadgeResult === "success") {
		appendSummary(`✅ Coverage badge updated on \`${badgesBranch}\` branch`);
	} else if (coverageBadgeResult === "skipped") {
		appendSummary("⏭️ Coverage badge skipped (CI did not pass)");
	} else {
		appendSummary("❌ Coverage badge push failed");
	}
}

if (enablePrComment) {
	appendSummary("");
	appendSummary("### PR Coverage Badge");
	if (prCommentResult === "success") {
		appendSummary("✅ Coverage badge injected into PR description");
	} else if (prCommentResult === "skipped") {
		appendSummary("⏭️ PR coverage badge skipped (not a pull_request event)");
	} else {
		appendSummary("❌ PR coverage badge update failed");
	}
}
