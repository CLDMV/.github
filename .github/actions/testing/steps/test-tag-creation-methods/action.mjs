#!/usr/bin/env node

/**
 * @fileoverview Test tag creation methods using existing CLDMV infrastructure
 * @description Comprehensive testing of tag creation via API vs git commands with proper GPG signing
 */

import * as core from "@actions/core";
import { getRefTag, createAnnotatedTag, createRefForTagObject, createRefToCommit } from "../../../github/api/_api/tag.mjs";
import { importGpgIfNeeded, configureGitIdentity, ensureGitAuthRemote, shouldSign } from "../../../github/api/_api/gpg.mjs";
import { gitCommand } from "../../../git/utilities/git-utils.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";

/**
 * Analyze token type and source
 * @param {string} token - Authentication token
 * @returns {Object} Token analysis
 */
function analyzeToken(token) {
	const tokenType = token.startsWith("ghs_")
		? "app_token"
		: token.startsWith("ghp_")
		? "personal_token"
		: token.startsWith("github_pat_")
		? "fine_grained_token"
		: "default_github_token";

	return {
		type: tokenType,
		length: token.length,
		prefix: token.substring(0, 7) + "...",
		isAppToken: tokenType === "app_token",
		isGitHubToken: tokenType === "default_github_token"
	};
}

/**
 * Setup Git configuration with authentication and signing
 * @param {Object} params - Configuration parameters
 */
async function setupGitConfig({ repo, token, tagger_name, tagger_email, gpg_private_key, gpg_passphrase }) {
	console.log("🔧 Setting up Git configuration...");

	// Setup authentication
	ensureGitAuthRemote(repo, token);

	// Setup GPG if provided
	let keyid = "";
	const enableSign = shouldSign({ sign: "auto", gpg_private_key });

	if (enableSign && gpg_private_key) {
		console.log("🔐 Importing GPG key...");
		keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
		console.log(`✅ GPG key imported: ${keyid}`);
	}

	// Configure Git identity
	configureGitIdentity({
		tagger_name,
		tagger_email,
		keyid,
		enableSign
	});

	return { keyid, enableSign };
}

/**
 * Create tag via GitHub API
 * @param {Object} params - Tag creation parameters
 * @returns {Object} Result of API tag creation
 */
async function createTagViaAPI({ token, repo, tag, targetCommit, tagger_name, tagger_email, enableSign }) {
	console.log("🧪 Testing API tag creation...");

	try {
		// Create annotated tag object
		const tagObject = await createAnnotatedTag({
			token,
			repo,
			tag: `${tag}-api`,
			message: `Test annotated tag created via API (signed: ${enableSign})`,
			objectSha: targetCommit,
			tagger: {
				name: tagger_name,
				email: tagger_email,
				date: new Date().toISOString()
			}
		});

		console.log(`✅ API tag object created: ${tagObject.sha}`);

		// Create ref pointing to tag object
		await createRefForTagObject({
			token,
			repo,
			tag: `${tag}-api`,
			tagObjectSha: tagObject.sha
		});

		console.log(`✅ API ref created: refs/tags/${tag}-api`);

		// Verify the tag
		const refInfo = await getRefTag({ token, repo, tag: `${tag}-api` });
		const isVerified = refInfo.objectType === "tag"; // annotated tags are verified

		return {
			success: true,
			tagSha: tagObject.sha,
			refSha: refInfo.refSha,
			isAnnotated: true,
			isVerified,
			method: "api"
		};
	} catch (error) {
		console.error(`❌ API tag creation failed: ${error.message}`);
		return {
			success: false,
			error: error.message,
			method: "api"
		};
	}
}

/**
 * Create tag via git commands
 * @param {Object} params - Tag creation parameters
 * @returns {Object} Result of git tag creation
 */
async function createTagViaGit({ tag, targetCommit, enableSign }) {
	console.log("🧪 Testing git command tag creation...");

	try {
		// Create annotated tag with git
		const tagName = `${tag}-git`;
		const message = `Test annotated tag created via git commands (signed: ${enableSign})`;

		// Create annotated tag locally
		const createCommand = `git tag -a "${tagName}" "${targetCommit}" -m "${message}"`;
		const createResult = gitCommand(createCommand);

		if (!createResult && createResult !== "") {
			throw new Error("Local tag creation failed");
		}

		console.log(`✅ Git tag created locally: ${tagName}`);

		// Push the tag
		const pushCommand = `git push origin "${tagName}"`;
		const pushResult = gitCommand(pushCommand);

		// Check if push was successful by verifying tag exists on remote
		const verifyCommand = `git ls-remote --tags origin "${tagName}"`;
		const verifyResult = gitCommand(verifyCommand, true);

		const pushSuccess = verifyResult.includes(tagName);

		if (!pushSuccess) {
			console.error(`❌ Git tag push failed - tag not found on remote`);
			return {
				success: false,
				error: "Tag push failed - not found on remote",
				localSuccess: true,
				pushSuccess: false,
				method: "git"
			};
		}

		console.log(`✅ Git tag pushed successfully: ${tagName}`);

		// Check if tag is signed
		const showCommand = `git show --show-signature "${tagName}"`;
		const showResult = gitCommand(showCommand, true);
		const isVerified = showResult.includes("gpg: Good signature") || showResult.includes("Signature made");

		return {
			success: true,
			localSuccess: true,
			pushSuccess: true,
			isAnnotated: true,
			isVerified,
			method: "git"
		};
	} catch (error) {
		console.error(`❌ Git tag creation failed: ${error.message}`);
		return {
			success: false,
			error: error.message,
			method: "git"
		};
	}
}

/**
 * Create release for a tag
 * @param {Object} params - Release creation parameters
 * @returns {Object} Result of release creation
 */
async function createRelease({ token, repo, tag, targetCommit, title, body, suffix }) {
	const { owner, repo: r } = parseRepo(repo);
	const releaseTag = `${tag}-${suffix}`;

	try {
		const release = await api(
			"POST",
			"/releases",
			{
				tag_name: releaseTag,
				target_commitish: targetCommit,
				name: title,
				body: body,
				draft: false,
				prerelease: true
			},
			{ token, owner, repo: r }
		);

		console.log(`✅ Release created: ${release.html_url}`);

		return {
			success: true,
			releaseId: release.id,
			releaseUrl: release.html_url,
			author: release.author?.login || "unknown"
		};
	} catch (error) {
		console.error(`❌ Release creation failed: ${error.message}`);
		return {
			success: false,
			error: error.message
		};
	}
}

/**
 * Cleanup test tags and releases
 * @param {Object} params - Cleanup parameters
 */
async function cleanup({ token, repo, tag }) {
	console.log("🧹 Cleaning up test artifacts...");
	const { owner, repo: r } = parseRepo(repo);

	const suffixes = ["api", "git"];

	for (const suffix of suffixes) {
		const tagName = `${tag}-${suffix}`;

		try {
			// Delete release first
			const release = await api("GET", `/releases/tags/${tagName}`, null, {
				token,
				owner,
				repo: r
			});

			if (release?.id) {
				await api("DELETE", `/releases/${release.id}`, null, {
					token,
					owner,
					repo: r
				});
				console.log(`🗑️ Deleted release: ${tagName}`);
			}
		} catch (error) {
			// Release might not exist, continue
		}

		try {
			// Delete tag ref
			await api("DELETE", `/git/refs/tags/${tagName}`, null, {
				token,
				owner,
				repo: r
			});
			console.log(`🗑️ Deleted tag: ${tagName}`);
		} catch (error) {
			// Tag might not exist, continue
		}
	}
}

/**
 * Main action execution
 */
async function run() {
	try {
		// Get inputs
		const inputs = {
			test_tag_name: core.getInput("test_tag_name", { required: true }),
			target_commit: core.getInput("target_commit") || "",
			cleanup_tag: core.getInput("cleanup_tag") === "true",
			use_github_token: core.getInput("use_github_token") === "true",
			token: core.getInput("token", { required: true }),
			tagger_name: core.getInput("tagger_name") || "CLDMV Bot",
			tagger_email: core.getInput("tagger_email") || "cldmv-bot@users.noreply.github.com",
			gpg_private_key: core.getInput("gpg_private_key"),
			gpg_passphrase: core.getInput("gpg_passphrase")
		};

		// Get repository info
		const repo = process.env.GITHUB_REPOSITORY;
		if (!repo) throw new Error("GITHUB_REPOSITORY not set");

		// Determine target commit
		const targetCommit = inputs.target_commit || gitCommand("git rev-parse HEAD").trim();

		// Analyze token
		const tokenAnalysis = analyzeToken(inputs.token);
		console.log("🔍 Token Analysis:");
		console.log(`  - Type: ${tokenAnalysis.type}`);
		console.log(`  - Length: ${tokenAnalysis.length}`);
		console.log(`  - Prefix: ${tokenAnalysis.prefix}`);
		console.log(`  - Source: ${inputs.use_github_token ? "GITHUB_TOKEN" : "App Token"}`);

		core.setOutput("token_type", inputs.use_github_token ? "github_token" : "app_token");

		// Setup Git configuration
		const { enableSign } = await setupGitConfig({
			repo,
			token: inputs.token,
			tagger_name: inputs.tagger_name,
			tagger_email: inputs.tagger_email,
			gpg_private_key: inputs.gpg_private_key,
			gpg_passphrase: inputs.gpg_passphrase
		});

		console.log(`🎯 Target commit: ${targetCommit}`);
		console.log(`🔐 GPG signing enabled: ${enableSign}`);

		// Test API tag creation
		const apiResult = await createTagViaAPI({
			token: inputs.token,
			repo,
			tag: inputs.test_tag_name,
			targetCommit,
			tagger_name: inputs.tagger_name,
			tagger_email: inputs.tagger_email,
			enableSign
		});

		// Test git tag creation
		const gitResult = await createTagViaGit({
			tag: inputs.test_tag_name,
			targetCommit,
			enableSign
		});

		// Set outputs
		core.setOutput("api_success", apiResult.success);
		core.setOutput("git_success", gitResult.success);
		core.setOutput("api_tag_verified", apiResult.isVerified || false);
		core.setOutput("git_tag_verified", gitResult.isVerified || false);

		// Create releases if tags were successful
		let apiReleaseResult = { success: false };
		let gitReleaseResult = { success: false };

		if (apiResult.success) {
			apiReleaseResult = await createRelease({
				token: inputs.token,
				repo,
				tag: inputs.test_tag_name,
				targetCommit,
				title: "Test Release (API Tag)",
				body: `Test release created for API-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${apiResult.isVerified}\n**GPG Signing**: ${enableSign}`,
				suffix: "api"
			});
		}

		if (gitResult.success) {
			gitReleaseResult = await createRelease({
				token: inputs.token,
				repo,
				tag: inputs.test_tag_name,
				targetCommit,
				title: "Test Release (Git Tag)",
				body: `Test release created for git-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${gitResult.isVerified}\n**GPG Signing**: ${enableSign}`,
				suffix: "git"
			});
		}

		core.setOutput("api_release_success", apiReleaseResult.success);
		core.setOutput("git_release_success", gitReleaseResult.success);

		// Summary
		console.log("\n📊 Test Results Summary:");
		console.log("┌─────────────────────────────────────────────────────────┐");
		console.log("│                      Tag Creation                       │");
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log(`│ API Method:        ${apiResult.success ? "✅ SUCCESS" : "❌ FAILED"} (verified: ${apiResult.isVerified || false})  │`);
		console.log(`│ Git Method:        ${gitResult.success ? "✅ SUCCESS" : "❌ FAILED"} (verified: ${gitResult.isVerified || false})  │`);
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log("│                    Release Creation                     │");
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log(`│ API Release:       ${apiReleaseResult.success ? "✅ SUCCESS" : "❌ FAILED"}                            │`);
		console.log(`│ Git Release:       ${gitReleaseResult.success ? "✅ SUCCESS" : "❌ FAILED"}                            │`);
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log("│                    Configuration                        │");
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log(`│ Token Type:        ${tokenAnalysis.type.padEnd(29)} │`);
		console.log(`│ GPG Signing:       ${enableSign ? "ENABLED".padEnd(29) : "DISABLED".padEnd(29)} │`);
		console.log(`│ Release Author:    ${(apiReleaseResult.author || gitReleaseResult.author || "unknown").padEnd(29)} │`);
		console.log("└─────────────────────────────────────────────────────────┘");

		// Cleanup if requested
		if (inputs.cleanup_tag) {
			await cleanup({
				token: inputs.token,
				repo,
				tag: inputs.test_tag_name
			});
		}
	} catch (error) {
		console.error(`💥 Action failed: ${error.message}`);
		core.setFailed(error.message);
	}
}

// Execute the action
run();
