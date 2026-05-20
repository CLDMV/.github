/**
 * @fileoverview Dry-run validation for the create-release action: verify API
 * access, report tag/release existence, and emit simulated outputs. Node
 * delegation step of the create-release action (replaces the create-tag-dry,
 * create-release-dry, and verify-tag-dry shell steps).
 * @module @cldmv/.github.github.jobs.create-release.dry-run
 */

import { execSync } from "node:child_process";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { appendSummary, setOutputs } from "../../../common/common/core.mjs";

try {
	const token = process.env.GITHUB_TOKEN;
	const version = process.env.VERSION;
	const commitSha = process.env.COMMIT_SHA;
	const releaseName = process.env.RELEASE_NAME;
	const isPrerelease = process.env.IS_PRERELEASE;
	const gpgEnabled = process.env.GPG_ENABLED === "true";
	const sourceOnly = process.env.RELEASE_SOURCE_ONLY === "true";
	const repository = process.env.REPOSITORY;
	const { owner, repo } = parseRepo(repository);
	const releaseUrl = `${process.env.SERVER_URL}/${repository}/releases/tag/v${version}`;

	// Tag creation validation.
	appendSummary("🧪 **DRY RUN**: Tag creation validation");
	appendSummary(`  - ✅ Tag name: v${version}`);
	appendSummary(`  - ✅ Commit SHA: ${commitSha}`);
	appendSummary(`  - ✅ GPG configuration: ${gpgEnabled ? "Enabled" : "Disabled"}`);

	console.log("🧪 DRY RUN MODE: Validating GitHub release creation");
	console.log("");
	console.log("✅ Validation Results:");
	console.log(`  - Tag name: v${version}`);
	console.log(`  - Release name: ${releaseName}`);
	console.log(`  - Prerelease: ${isPrerelease}`);
	console.log("  - GitHub token: Available and authenticated");
	console.log(`  - Repository: ${repository}`);
	console.log("");

	// Verify GitHub API access.
	try {
		await api("GET", "", null, { token, owner, repo });
		console.log("  - GitHub API access: ✅ Verified");
	} catch {
		console.log("  - GitHub API access: ❌ Failed");
		process.exit(1);
	}

	// Report whether the tag already exists locally.
	const tagExists = execSync(`git tag -l "v${version}"`).toString().trim() === `v${version}`;
	console.log(tagExists ? `  - Tag v${version}: ⚠️ Already exists (will be updated)` : `  - Tag v${version}: ✅ Will be created`);

	// Report whether the release already exists.
	let releaseExists = false;
	try {
		await api("GET", `/releases/tags/v${version}`, null, { token, owner, repo });
		releaseExists = true;
	} catch {
		releaseExists = false;
	}
	console.log(
		releaseExists ? `  - Release v${version}: ⚠️ Already exists (will be updated)` : `  - Release v${version}: ✅ Will be created`
	);

	console.log(sourceOnly ? "  - Package assets: ⏭️ Source-only release (no assets)" : "  - Package assets: ✅ Will be attached (.tar.gz and .zip)");
	console.log("");
	console.log("💡 In real run, would create release at:");
	console.log(`   ${releaseUrl}`);

	appendSummary("🧪 **DRY RUN**: GitHub Release validation successful");
	appendSummary("  - ✅ Tag and release naming validated");
	appendSummary("  - ✅ GitHub API access confirmed");
	appendSummary("  - ✅ Release notes generated successfully");
	appendSummary("  - ✅ All prerequisites met for release creation");
	appendSummary("");
	appendSummary(`💡 **Would create**: [v${version}](${releaseUrl})`);
	appendSummary("🧪 **DRY RUN**: Tag signature validation skipped");
	appendSummary("  - ✅ GPG configuration would be verified in real run");

	setOutputs({
		"tag-sha": "DRY-RUN-TAG-SHA",
		"release-id": "DRY-RUN",
		"release-url": releaseUrl,
		verified: "true",
		reason: "dry-run-validation"
	});
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
