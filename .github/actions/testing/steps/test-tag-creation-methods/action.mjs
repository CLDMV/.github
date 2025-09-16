#!/usr/bin/env node

/**
 * @fileoverview Test tag creation methods using existing CLDMV infrastructure
 * @description Comprehensive testing of tag creation via API vs git commands with proper GPG signing
 */

import { getRefTag, createAnnotatedTag, createRefForTagObject, createRefToCommit } from "../../../github/api/_api/tag.mjs";
import { importGpgIfNeeded, configureGitIdentity, ensureGitAuthRemote, shouldSign } from "../../../github/api/_api/gpg.mjs";
import { gitCommand } from "../../../git/utilities/git-utils.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";
import * as fs from "fs";

/**
 * Simple @actions/core replacement
 */
const core = {
	getInput: (name, options = {}) => {
		const val = process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] || "";
		if (options.required && !val) {
			throw new Error(`Input required and not supplied: ${name}`);
		}
		return val;
	},
	setOutput: (name, value) => {
		const filePath = process.env.GITHUB_OUTPUT;
		if (filePath) {
			fs.appendFileSync(filePath, `${name}=${value}\n`);
		} else {
			console.warn(`GITHUB_OUTPUT not set, output ${name}=${value} not saved`);
		}
	},
	setFailed: (message) => {
		console.log(`::error::${message}`);
		process.exit(1);
	}
};

/**
 * Analyze token type and source
 * @param {string} token - Authentication token
 * @param {boolean} useGitHubToken - Whether this is explicitly the GITHUB_TOKEN
 * @returns {Object} Token analysis
 */
function analyzeToken(token, useGitHubToken = false) {
	// If explicitly marked as GITHUB_TOKEN, classify it as such regardless of prefix
	if (useGitHubToken) {
		return {
			type: "github_token",
			length: token.length,
			prefix: token.substring(0, 7) + "...",
			isAppToken: false,
			isGitHubToken: true
		};
	}

	const tokenType = token.startsWith("ghs_")
		? "app_token"
		: token.startsWith("ghp_")
		? "personal_token"
		: token.startsWith("github_pat_")
		? "fine_grained_token"
		: "github_token";

	return {
		type: tokenType,
		length: token.length,
		prefix: token.substring(0, 7) + "...",
		isAppToken: tokenType === "app_token",
		isGitHubToken: tokenType === "github_token"
	};
}

/**
 * Setup Git configuration for tagging
 */
function setupGitConfig({ tagger_name, tagger_email, gpg_private_key, gpg_passphrase, token, repo }) {
	// Setup authentication
	ensureGitAuthRemote(repo, token);

	// Setup GPG if provided
	let keyid = "";
	const enableSign = shouldSign({ sign: "auto", gpg_private_key });

	console.log(`🔍 GPG Configuration Check:`);
	console.log(`  - GPG Private Key provided: ${gpg_private_key ? `Yes (${gpg_private_key.length} chars)` : "No"}`);
	console.log(`  - GPG Passphrase provided: ${gpg_passphrase ? `Yes (${gpg_passphrase.length} chars)` : "No"}`);
	console.log(`  - Should sign (auto): ${enableSign}`);

	if (enableSign && gpg_private_key) {
		console.log("🔐 Importing GPG key...");
		try {
			keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
			console.log(`✅ GPG key imported successfully: ${keyid}`);

			// Set ultimate trust for the imported key (critical for verification)
			if (keyid) {
				console.log(`🔑 Setting ultimate trust for key ${keyid}...`);
				try {
					gitCommand(`echo "${keyid}:6:" | gpg --batch --import-ownertrust`, true);
					console.log(`✅ Trust set successfully for key ${keyid}`);
				} catch (trustError) {
					console.log(`⚠️  Could not set trust for key ${keyid}: ${trustError.message}`);
				}
			}
		} catch (error) {
			console.log(`❌ GPG key import failed: ${error.message}`);
			console.log(`📄 Error details: ${error.stack}`);
		}
	} else {
		console.log(`⏭️  GPG signing skipped: enableSign=${enableSign}, hasKey=${Boolean(gpg_private_key)}`);
	}

	// Configure Git identity
	configureGitIdentity({
		tagger_name,
		tagger_email,
		keyid,
		enableSign
	});

	console.log(`🔐 GPG signing setup: enabled=${enableSign}, keyid=${keyid || "none"}`);

	// Debug: Check final Git configuration
	try {
		const gitUserName = gitCommand("git config user.name", true) || "not set";
		const gitUserEmail = gitCommand("git config user.email", true) || "not set";
		const gitSigningKey = gitCommand("git config user.signingkey", true) || "not set";
		const gitTagGpgSign = gitCommand("git config tag.gpgsign", true) || "not set";
		const gitCommitGpgSign = gitCommand("git config commit.gpgsign", true) || "not set";
		const gitGpgProgram = gitCommand("git config gpg.program", true) || "not set";

		console.log(`📋 Final Git Configuration:`);
		console.log(`  - user.name: ${gitUserName}`);
		console.log(`  - user.email: ${gitUserEmail}`);
		console.log(`  - user.signingkey: ${gitSigningKey}`);
		console.log(`  - tag.gpgsign: ${gitTagGpgSign}`);
		console.log(`  - commit.gpgsign: ${gitCommitGpgSign}`);
		console.log(`  - gpg.program: ${gitGpgProgram}`);

		// Debug GPG key info
		if (keyid) {
			try {
				const gpgKeyInfo = gitCommand(`gpg --list-secret-keys --keyid-format LONG ${keyid}`, true);
				console.log(`🔑 GPG Key Info for ${keyid}:`);
				console.log(gpgKeyInfo);

				const trustInfo = gitCommand(`gpg --list-keys --with-colons ${keyid} | grep "^pub" | cut -d: -f2`, true);
				console.log(`🔐 Trust level: ${trustInfo || "unknown"}`);
			} catch (keyInfoError) {
				console.log(`⚠️  Could not get GPG key info: ${keyInfoError.message}`);
			}
		}
	} catch (configError) {
		console.log(`⚠️  Could not read Git configuration: ${configError.message}`);
	}

	return { enableSign, keyid };
}

/**
 * Verify GPG signature on a tag
 * @param {string} tagName - Name of the tag to verify
 * @returns {Object} Verification result
 */
function verifyGpgSignature(tagName) {
	try {
		console.log(`🔍 Verifying GPG signature for tag ${tagName}...`);

		// Try to get signature information using git show
		const gitShowOutput = gitCommand(`git show --show-signature ${tagName}`, true);
		console.log(`📄 Git show output for ${tagName}:`);
		console.log(gitShowOutput);

		// Check for actual signature verification
		const hasGoodSignature = gitShowOutput.includes("Good signature from");
		const hasValidSignature = gitShowOutput.includes("Signature made") && hasGoodSignature;
		const hasSignatureBlock = gitShowOutput.includes("-----BEGIN PGP SIGNATURE-----");

		let signatureStatus;
		let gpgStatusText;

		if (hasValidSignature) {
			signatureStatus = "verified";
			gpgStatusText = "verified and trusted";
			console.log(`✅ GPG signature verified for tag ${tagName}`);
		} else if (hasSignatureBlock) {
			signatureStatus = "signed";
			gpgStatusText = "signed but not verified (trust/key issues)";
			console.log(`⚠️  GPG output present but signature not verified (trust/key issues)`);
		} else {
			signatureStatus = "unsigned";
			gpgStatusText = "not signed";
			console.log(`❌ No GPG signature found for tag ${tagName}`);
		}

		return {
			verified: hasValidSignature,
			signed: hasSignatureBlock,
			status: signatureStatus,
			statusText: gpgStatusText,
			output: gitShowOutput
		};
	} catch (error) {
		console.log(`❌ GPG verification failed for tag ${tagName}: ${error.message}`);
		return {
			verified: false,
			signed: false,
			status: "error",
			statusText: `verification error: ${error.message}`,
			output: ""
		};
	}
}

/**
 * Test API-based tag creation
 */
async function testApiTagCreation({ token, repo, tagName, targetCommit, tagger_name, tagger_email }) {
	try {
		console.log(`🔗 Testing API-based tag creation for ${tagName}...`);

		const response = await api({
			token,
			method: "POST",
			endpoint: `/repos/${repo}/git/refs`,
			data: {
				ref: `refs/tags/${tagName}`,
				sha: targetCommit
			}
		});

		if (response.status === 201) {
			console.log(`✅ API tag creation successful for ${tagName}`);

			// Verify the tag was created
			const verifyResponse = await api({
				token,
				method: "GET",
				endpoint: `/repos/${repo}/git/refs/tags/${tagName}`
			});

			if (verifyResponse.status === 200) {
				console.log(`✅ API tag verification successful for ${tagName}`);
				return { success: true, sha: response.data.object.sha };
			} else {
				throw new Error(`Tag verification failed: ${verifyResponse.status}`);
			}
		} else {
			throw new Error(`API tag creation failed: ${response.status} - ${response.data?.message || "Unknown error"}`);
		}
	} catch (error) {
		console.log(`❌ API tag creation failed for ${tagName}: ${error.message}`);
		return { success: false, error: error.message };
	}
}

/**
 * Test Git-based tag creation
 */
function testGitTagCreation({ tagName, targetCommit, enableSign }) {
	try {
		console.log(`⚡ Testing Git-based tag creation for ${tagName}...`);

		// Create the tag locally
		const tagCommand = enableSign
			? `git tag -a -s ${tagName} ${targetCommit} -m "Test tag ${tagName}"`
			: `git tag -a ${tagName} ${targetCommit} -m "Test tag ${tagName}"`;

		console.log(`🔍 DEBUG: Executing tag command: ${tagCommand}`);
		gitCommand(tagCommand);
		console.log(`✅ Local tag created: ${tagName}`);

		// Push the tag
		console.log(`📤 Pushing tag ${tagName} to remote...`);
		gitCommand(`git push origin ${tagName}`);
		console.log(`✅ Git tag creation successful for ${tagName}`);

		// Get the tag SHA
		const tagSha = gitCommand(`git rev-parse ${tagName}`, true);
		return { success: true, sha: tagSha.trim() };
	} catch (error) {
		console.log(`❌ Git tag creation failed for ${tagName}: ${error.message}`);
		return { success: false, error: error.message };
	}
}

/**
 * Create a GitHub release
 */
async function createRelease({ token, repo, tag, targetCommit, title, body, suffix }) {
	try {
		console.log(`🎁 Creating GitHub release for ${tag}...`);

		const releaseResponse = await api({
			token,
			method: "POST",
			endpoint: `/repos/${repo}/releases`,
			data: {
				tag_name: tag,
				target_commitish: targetCommit,
				name: `${title} (${suffix})`,
				body: body,
				draft: false,
				prerelease: true
			}
		});

		if (releaseResponse.status === 201) {
			const releaseData = releaseResponse.data;
			console.log(`✅ GitHub release created: ${releaseData.html_url}`);
			return {
				success: true,
				id: releaseData.id,
				url: releaseData.html_url,
				author: releaseData.author?.login || "unknown"
			};
		} else {
			throw new Error(`Release creation failed: ${releaseResponse.status} - ${releaseResponse.data?.message || "Unknown error"}`);
		}
	} catch (error) {
		console.log(`❌ GitHub release creation failed for ${tag}: ${error.message}`);
		return { success: false, error: error.message };
	}
}

/**
 * Cleanup test artifacts
 */
async function cleanup({ token, repo, tag }) {
	try {
		console.log(`🧹 Cleaning up test tag: ${tag}`);

		// Delete the tag locally
		try {
			gitCommand(`git tag -d ${tag}`, true);
			console.log(`✅ Local tag ${tag} deleted`);
		} catch (error) {
			console.log(`ℹ️  Local tag ${tag} not found or already deleted`);
		}

		// Delete the tag remotely
		try {
			gitCommand(`git push origin :refs/tags/${tag}`, true);
			console.log(`✅ Remote tag ${tag} deleted`);
		} catch (error) {
			console.log(`ℹ️  Remote tag ${tag} not found or already deleted`);
		}

		// Delete any associated releases
		try {
			const releasesResponse = await api({
				token,
				method: "GET",
				endpoint: `/repos/${repo}/releases`
			});

			for (const release of releasesResponse.data) {
				if (release.tag_name === tag) {
					await api({
						token,
						method: "DELETE",
						endpoint: `/repos/${repo}/releases/${release.id}`
					});
					console.log(`✅ Release for tag ${tag} deleted`);
				}
			}
		} catch (error) {
			console.log(`ℹ️  No releases found for tag ${tag} or cleanup failed: ${error.message}`);
		}

		return { success: true };
	} catch (error) {
		console.log(`⚠️  Cleanup failed for ${tag}: ${error.message}`);
		return { success: false, error: error.message };
	}
}

/**
 * Cleanup all test artifacts matching a pattern
 */
async function cleanupAllTestArtifacts({ token, repo, pattern }) {
	try {
		console.log(`🧹 Cleaning up all test artifacts matching pattern: ${pattern}`);

		// Get all tags
		const tagsOutput = gitCommand("git tag --list", true);
		const tags = tagsOutput.split("\n").filter((tag) => tag.trim() && tag.includes(pattern));

		for (const tag of tags) {
			await cleanup({ token, repo, tag: tag.trim() });
		}

		console.log(`✅ Cleanup completed for ${tags.length} test artifacts`);
		return { success: true, cleaned: tags.length };
	} catch (error) {
		console.log(`⚠️  Test artifacts cleanup failed: ${error.message}`);
		return { success: false, error: error.message };
	}
}

/**
 * Main execution function
 */
async function run() {
	try {
		// Get inputs
		const inputs = {
			test_tag_name: core.getInput("test_tag_name", { required: true }),
			target_commit: core.getInput("target_commit") || process.env.GITHUB_SHA,
			cleanup_tag: core.getInput("cleanup_tag") === "true",
			cleanup_all_test_tags: core.getInput("cleanup_all_test_tags") === "true",
			cleanup_only: core.getInput("cleanup_only") === "true",
			use_github_token: core.getInput("use_github_token") === "true",
			token: core.getInput("token", { required: true }),
			tagger_name: core.getInput("tagger_name") || "test-bot",
			tagger_email: core.getInput("tagger_email") || "test-bot@example.com",
			gpg_private_key: core.getInput("gpg_private_key"),
			gpg_passphrase: core.getInput("gpg_passphrase"),
			cleanup_all_test_artifacts: core.getInput("cleanup_all_test_artifacts") === "true"
		};

		const repo = parseRepo(process.env.GITHUB_REPOSITORY);
		const targetCommit = inputs.target_commit;

		console.log(`🎯 Target commit: ${targetCommit}`);
		console.log(`🏷️  Test tag name: ${inputs.test_tag_name}`);

		// Analyze token
		const tokenAnalysis = analyzeToken(inputs.token, inputs.use_github_token);
		console.log(`🔐 Token analysis: ${JSON.stringify(tokenAnalysis, null, 2)}`);

		// If cleanup_only is true, just do cleanup and exit
		if (inputs.cleanup_only) {
			console.log("🧹 Cleanup-only mode enabled");
			if (inputs.cleanup_all_test_artifacts) {
				await cleanupAllTestArtifacts({
					token: inputs.token,
					repo,
					pattern: "test-debug"
				});
			}
			return;
		}

		// Setup Git configuration
		const { enableSign, keyid } = setupGitConfig({
			tagger_name: inputs.tagger_name,
			tagger_email: inputs.tagger_email,
			gpg_private_key: inputs.gpg_private_key,
			gpg_passphrase: inputs.gpg_passphrase,
			token: inputs.token,
			repo
		});

		console.log(`🔐 GPG signing enabled: ${enableSign}`);

		// Test API tag creation
		console.log("\n🔗 Testing API-based tag creation...");
		const apiResult = await testApiTagCreation({
			token: inputs.token,
			repo,
			tagName: inputs.test_tag_name,
			targetCommit,
			tagger_name: inputs.tagger_name,
			tagger_email: inputs.tagger_email
		});

		// Test API GPG verification if API tag was created
		let apiGpgVerified = false;
		if (apiResult.success) {
			const apiGpgResult = verifyGpgSignature(inputs.test_tag_name);
			apiGpgVerified = apiGpgResult.verified;
			apiResult.apiGpgVerified = apiGpgVerified;
			console.log(`🔍 API tag GPG verification: ${apiGpgResult.statusText}`);
		}

		// Test Git tag creation (will overwrite API tag if it exists)
		console.log("\n⚡ Testing Git-based tag creation...");
		const gitResult = await testGitTagCreation({
			tagName: inputs.test_tag_name,
			targetCommit,
			enableSign
		});

		// Test Git GPG verification if Git tag was created
		let gitGpgVerified = false;
		if (gitResult.success) {
			const gitGpgResult = verifyGpgSignature(inputs.test_tag_name);
			gitGpgVerified = gitGpgResult.verified;
			gitResult.gitGpgVerified = gitGpgVerified;

			// Determine appropriate status text
			let gpgStatusText;
			let signatureStatus;

			if (enableSign) {
				if (gitGpgResult.verified) {
					gpgStatusText = "verified and trusted";
					signatureStatus = "✅ Verified";
				} else if (gitGpgResult.signed) {
					gpgStatusText = "signed but not verified (trust/key issues)";
					signatureStatus = "⚠️  Signed but not verified";
				} else {
					gpgStatusText = "signing failed";
					signatureStatus = "❌ Signing failed";
				}
			} else {
				gpgStatusText = "signing disabled";
				signatureStatus = "⏭️  Signing disabled";
			}

			console.log(`🔍 Git tag GPG verification: ${gpgStatusText}`);
		}

		// Create releases for both methods
		console.log("\n🎁 Creating GitHub releases...");

		const apiReleaseResult = await createRelease({
			token: inputs.token,
			repo,
			tag: inputs.test_tag_name,
			targetCommit,
			title: "Test Release (API Tag)",
			body: `Test release created for API-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${
				apiGpgVerified ? "✅ Verified" : "❌ Not verified"
			}\n**GPG Signing**: API tags do not support GPG signing`,
			suffix: "api"
		});

		const gitReleaseResult = await createRelease({
			token: inputs.token,
			repo,
			tag: inputs.test_tag_name,
			targetCommit,
			title: "Test Release (Git Tag)",
			body: `Test release created for git-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${
				gitGpgVerified ? "✅ Verified" : "❌ Not verified"
			}\n**GPG Signing**: ${enableSign ? (gitGpgVerified ? "✅ Verified" : "⚠️  Signed but not verified") : "⏭️  Disabled"}`,
			suffix: "git"
		});

		// Set outputs
		core.setOutput("api_release_success", apiReleaseResult.success);
		core.setOutput("git_release_success", gitReleaseResult.success);
		core.setOutput(
			"overall_result",
			apiResult.success && gitResult.success && apiReleaseResult.success && gitReleaseResult.success ? "success" : "failure"
		);
		core.setOutput("git_result", gitResult.success ? "success" : "failure");
		core.setOutput("api_result", apiResult.success ? "success" : "failure");
		core.setOutput("api_gpg_result", enableSign && apiGpgVerified ? "success" : "failure");
		core.setOutput("git_gpg_result", enableSign && gitGpgVerified ? "success" : "failure");
		core.setOutput("gpg_result", enableSign && (apiGpgVerified || gitGpgVerified) ? "success" : "failure");
		core.setOutput("token_type", tokenAnalysis.type);
		core.setOutput("api_tag_verified", apiGpgVerified);
		core.setOutput("git_tag_verified", gitGpgVerified);

		const details = {
			tokenType: tokenAnalysis.type,
			apiSuccess: apiResult.success,
			gitSuccess: gitResult.success,
			apiGpgVerified: apiGpgVerified,
			gitGpgVerified: gitGpgVerified,
			apiReleaseSuccess: apiReleaseResult.success,
			gitReleaseSuccess: gitReleaseResult.success,
			gpgEnabled: enableSign,
			errors: [
				...(apiResult.error ? [`API: ${apiResult.error}`] : []),
				...(gitResult.error ? [`Git: ${gitResult.error}`] : []),
				...(apiReleaseResult.error ? [`API Release: ${apiReleaseResult.error}`] : []),
				...(gitReleaseResult.error ? [`Git Release: ${gitReleaseResult.error}`] : [])
			]
		};

		core.setOutput("details", JSON.stringify(details));

		// Summary
		console.log("\n📊 Test Results Summary:");
		console.log("┌─────────────────────────────────────────────────────────┐");
		console.log("│                      Tag Creation                       │");
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log(`│ API Method:        ${apiResult.success ? "✅ SUCCESS" : "❌ FAILED"}                            │`);
		console.log(`│ Git Method:        ${gitResult.success ? "✅ SUCCESS" : "❌ FAILED"}                            │`);
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log("│                    GPG Verification                     │");
		console.log("├─────────────────────────────────────────────────────────┤");
		console.log(`│ API GPG Signed:    ${enableSign ? (apiGpgVerified ? "✅ VERIFIED" : "❌ NOT SIGNED") : "⏭️  SKIPPED"}        │`);
		console.log(`│ Git GPG Signed:    ${enableSign ? (gitGpgVerified ? "✅ VERIFIED" : "❌ NOT SIGNED") : "⏭️  SKIPPED"}        │`);
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
		if (inputs.cleanup_all_test_artifacts) {
			await cleanupAllTestArtifacts({
				token: inputs.token,
				repo,
				pattern: "test-debug"
			});
		} else if (inputs.cleanup_tag) {
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
