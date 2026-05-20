/**
 * @fileoverview Write the full create-release-pr step summary in one pass
 * (version, changelog, commit, PR — dry-run and real). Node delegation step of
 * the create-release-pr action.
 * @module @cldmv/.github.github.jobs.create-release-pr.summary
 */

import { appendSummary } from "../../../common/common/core.mjs";

const dryRun = process.env.DRY_RUN === "true";
const newVersion = process.env.NEW_VERSION;
const defaultBranch = process.env.DEFAULT_BRANCH;
const headBranch = process.env.HEAD_BRANCH;
const prLabels = process.env.PR_LABELS;
const prCreated = process.env.PR_CREATED === "true";
const prNumber = process.env.PR_NUMBER;
const repository = process.env.REPOSITORY;
const serverUrl = process.env.SERVER_URL;
const changelog = process.env.CHANGELOG_CONTENT || "";

// Version
appendSummary(`- ✅ New version calculated: v${newVersion}`);
if (dryRun) appendSummary(`- 🧪 **DRY RUN**: Version would be bumped to v${newVersion}`);

// Package version update
if (dryRun) appendSummary(`- 🧪 **DRY RUN**: Would update package.json version to ${newVersion}`);

// Changelog
appendSummary("- ✅ Changelog generated successfully");
if (dryRun) {
	appendSummary("- 🧪 **DRY RUN**: Changelog content preview:");
	appendSummary("");
	appendSummary("```");
	appendSummary(changelog.split("\n").slice(0, 20).join("\n"));
	appendSummary("```");
	appendSummary("");
}

// Commit
if (dryRun) {
	appendSummary(`- 🧪 **DRY RUN**: Would create commit with message: 'chore: bump version to ${newVersion}'`);
}

// Pull request
if (dryRun) {
	appendSummary("- 🧪 **DRY RUN**: Would create PR with:");
	appendSummary(`  - **Title**: release: v${newVersion}`);
	appendSummary(`  - **Base Branch**: ${defaultBranch}`);
	appendSummary(`  - **Head Branch**: ${headBranch}`);
	appendSummary(`  - **Labels**: ${prLabels}`);
	appendSummary("");
	appendSummary("");
	appendSummary("🧪 **DRY RUN COMPLETE** - All validations passed!");
	appendSummary("");
	appendSummary("### What would happen in a real run:");
	appendSummary(`1. ✅ Version would be bumped to **v${newVersion}**`);
	appendSummary("2. ✅ Package.json would be updated");
	appendSummary("3. ✅ Changelog would be generated");
	appendSummary("4. ✅ Release commit would be created");
	appendSummary("5. ✅ Release PR would be opened");
	appendSummary("");
	appendSummary("💡 **To proceed**: Run this workflow again with `dry_run: false`");
} else if (prCreated) {
	const prUrl = `${serverUrl}/${repository}/pull/${prNumber}`;
	appendSummary(`- ✅ Release PR created: [#${prNumber}](${prUrl})`);
	appendSummary("");
	appendSummary(`🎉 **Release PR Complete** - [Ready for review and merge →](${prUrl})`);
} else {
	appendSummary("- ℹ️ No release PR created (not a release commit)");
	appendSummary("");
	appendSummary("💡 **Tip**: Use `release:` or `release!:` prefix to trigger releases");
}
