#!/usr/bin/env node

/**
 * @fileoverview Test tag creation methods using existing CLDMV infrastru	if (enableSign && gpg_private_key) {
		console.log("🔐 Setting up complete GPG chain (matching production workflow)...");
		try {
			// Steps 1-2: Import GPG key and setup non-interactive GPG (like production)
			// This calls exportGpgEnv internally and sets up the complete chain
			console.log("📋 Steps 1-2: Importing GPG key and setting up non-interactive mode...");
			keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
			console.log(`✅ GPG key imported successfully: ${keyid}`);
			
			// Step 3: Set ultimate trust for the imported key (critical for verification)
			console.log(`📋 Step 3: Setting ultimate trust for key ${keyid}...`);
			try {
				gitCommand(`echo "${keyid}:6:" | gpg --batch --import-ownertrust`, true);
				console.log(`✅ Ultimate trust set successfully for key ${keyid}`);
			} catch (trustError) {
				console.log(`⚠️  Could not set trust for key ${keyid}: ${trustError.message}`);
			}
			
			// Step 4: Verify GPG setup works
			console.log("📋 Step 4: Verifying GPG setup...");
			try {
				const testSign = gitCommand(`echo "test" | gpg --batch --armor --detach-sign`, true);
				console.log(`✅ GPG test signing successful (${testSign.length} chars)`);
			} catch (testError) {
				console.log(`⚠️  GPG test signing failed: ${testError.message}`);
			}
		} catch (error) {
			console.log(`❌ GPG setup failed: ${error.message}`);
			console.log(`📄 Error details: ${error.stack}`);
		}
	} else {
		console.log(`⏭️  GPG signing skipped: enableSign=${enableSign}, hasKey=${Boolean(gpg_private_key)}`);
	}ption Comprehensive testing of tag creation via API vs git commands with proper GPG signing
 */

import { getRefTag, createAnnotatedTag, createRefForTagObject, createRefToCommit } from "../../../github/api/_api/tag.mjs";
import {
	importGpgIfNeeded,
	configureGitIdentity,
	ensureGitAuthRemote,
	shouldSign,
	setupNonInteractiveGpg
} from "../../../github/api/_api/gpg.mjs";
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

	// Setup GPG if provided - Match production workflow setup chain
	let keyid = "";
	const enableSign = shouldSign({ sign: "auto", gpg_private_key });

	console.log(`🔍 GPG Configuration Check:`);
	console.log(`  - GPG Private Key provided: ${gpg_private_key ? `Yes (${gpg_private_key.length} chars)` : "No"}`);
	console.log(`  - GPG Passphrase provided: ${gpg_passphrase ? `Yes (${gpg_passphrase.length} chars)` : "No"}`);
	console.log(`  - Should sign (auto): ${enableSign}`);

	if (enableSign && gpg_private_key) {
		console.log("🔐 Setting up complete GPG chain (matching production workflow)...");
		try {
			// Step 1: Set up GPG environment (like production)
			console.log("📋 Step 1: Setting up GPG environment...");
			exportGpgEnv({ gpg_passphrase });

			// Step 2: Import GPG key and setup non-interactive GPG (like production)
			console.log("� Step 2: Importing GPG key and setting up non-interactive mode...");
			keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
			console.log(`✅ GPG key imported successfully: ${keyid}`);

			// Step 3: Set ultimate trust for the imported key (critical for verification)
			console.log(`� Step 3: Setting ultimate trust for key ${keyid}...`);
			try {
				gitCommand(`echo "${keyid}:6:" | gpg --batch --import-ownertrust`, true);
				console.log(`✅ Ultimate trust set successfully for key ${keyid}`);
			} catch (trustError) {
				console.log(`⚠️  Could not set trust for key ${keyid}: ${trustError.message}`);
			}

			// Step 4: Verify GPG setup works
			console.log("📋 Step 4: Verifying GPG setup...");
			try {
				const testSign = gitCommand(`echo "test" | gpg --batch --armor --detach-sign`, true);
				console.log(`✅ GPG test signing successful (${testSign.length} chars)`);
			} catch (testError) {
				console.log(`⚠️  GPG test signing failed: ${testError.message}`);
			}
		} catch (error) {
			console.log(`❌ GPG setup failed: ${error.message}`);
			console.log(`📄 Error details: ${error.stack}`);
		}
	} else {
		console.log(`⏭️  GPG signing skipped: enableSign=${enableSign}, hasKey=${Boolean(gpg_private_key)}`);
	}

	// Configure Git identity (matching production workflow)
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
		const isAnnotated = refInfo.objectType === "tag";

		// Check GPG signature verification via API
		let apiGpgVerified = false;
		try {
			// Get the tag object details which include verification info
			const { owner, repo: r } = parseRepo(repo);
			const tagDetails = await api("GET", `/git/tags/${tagObject.sha}`, null, {
				token,
				owner,
				repo: r
			});

			// Check if there's verification info (GitHub Apps can create signed tags)
			apiGpgVerified = tagDetails.verification?.verified === true;
			console.log(`🔍 API GPG verification: ${apiGpgVerified ? "✅ verified" : "❌ not verified"}`);
			if (tagDetails.verification) {
				console.log(`   Verification reason: ${tagDetails.verification.reason || "none"}`);
			}
		} catch (verifyError) {
			console.log(`⚠️  Could not check API GPG verification: ${verifyError.message}`);
		}

		return {
			success: true,
			tagSha: tagObject.sha,
			refSha: refInfo.refSha,
			isAnnotated,
			apiGpgVerified,
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

		// Check if tag is GPG signed
		const showCommand = `git show --show-signature "${tagName}"`;
		const showResult = gitCommand(showCommand, true);

		// Check for different levels of GPG status
		const hasGoodSignature = showResult.includes("gpg: Good signature");
		const hasBadSignature = showResult.includes("gpg: Bad signature");
		const hasSignatureWarning = showResult.includes("gpg: WARNING") || showResult.includes("gpg: Can't check signature");
		const hasSignatureBlock = showResult.includes("-----BEGIN PGP SIGNATURE-----");
		const hasGpgOutput = showResult.includes("gpg:");

		// Determine verification status
		let gitGpgVerified = false;
		let signatureStatus = "unsigned";

		if (hasGoodSignature && !hasSignatureWarning) {
			gitGpgVerified = true;
			signatureStatus = "verified";
		} else if (hasBadSignature) {
			signatureStatus = "invalid";
		} else if (hasSignatureBlock || hasGpgOutput) {
			signatureStatus = "signed but unverified";
		}

		console.log(`🔍 Git GPG verification: ${gitGpgVerified ? "✅ verified" : "❌ not verified"}`);
		console.log(`� Signature status: ${signatureStatus}`);
		console.log(`�📄 Git show output preview: ${showResult.substring(0, 300)}...`);

		if (hasSignatureBlock) {
			console.log(`🔐 PGP signature block detected - tag is signed`);
		}
		if (hasGpgOutput && !hasGoodSignature) {
			console.log(`⚠️  GPG output present but signature not verified (trust/key issues)`);
		}

		return {
			success: true,
			localSuccess: true,
			pushSuccess: true,
			isAnnotated: true,
			gitGpgVerified,
			signatureStatus,
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
 * Enhanced cleanup for all test artifacts matching a pattern
 * @param {Object} params - Cleanup parameters
 */
async function cleanupAllTestArtifacts({ token, repo, pattern = "test-debug" }) {
	console.log(`🧹 Cleaning up ALL test artifacts matching pattern: ${pattern}...`);
	const { owner, repo: r } = parseRepo(repo);

	try {
		// Get all releases
		const releases = await api("GET", "/releases", null, {
			token,
			owner,
			repo: r
		});

		// Filter and delete test releases
		for (const release of releases) {
			if (release.tag_name.includes(pattern)) {
				try {
					await api("DELETE", `/releases/${release.id}`, null, {
						token,
						owner,
						repo: r
					});
					console.log(`🗑️ Deleted release: ${release.tag_name}`);
				} catch (error) {
					console.log(`⚠️  Could not delete release ${release.tag_name}: ${error.message}`);
				}
			}
		}

		// Get all tags
		const tags = await api("GET", "/git/refs/tags", null, {
			token,
			owner,
			repo: r
		});

		// Filter and delete test tags
		for (const tag of tags) {
			const tagName = tag.ref.replace("refs/tags/", "");
			if (tagName.includes(pattern)) {
				try {
					await api("DELETE", `/git/refs/tags/${tagName}`, null, {
						token,
						owner,
						repo: r
					});
					console.log(`🗑️ Deleted tag: ${tagName}`);
				} catch (error) {
					console.log(`⚠️  Could not delete tag ${tagName}: ${error.message}`);
				}
			}
		}
	} catch (error) {
		console.log(`⚠️  Cleanup error: ${error.message}`);
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
			cleanup_all_test_tags: core.getInput("cleanup_all_test_tags") === "true",
			cleanup_only: core.getInput("cleanup_only") === "true",
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
		const tokenAnalysis = analyzeToken(inputs.token, inputs.use_github_token);
		console.log("🔍 Token Analysis:");
		console.log(`  - Type: ${tokenAnalysis.type}`);
		console.log(`  - Length: ${tokenAnalysis.length}`);
		console.log(`  - Prefix: ${tokenAnalysis.prefix}`);
		console.log(`  - Source: ${inputs.use_github_token ? "GITHUB_TOKEN" : "App Token"}`);

		// Use actual token analysis result instead of input parameter
		core.setOutput("token_type", tokenAnalysis.type);

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

		// Handle cleanup-only mode
		if (inputs.cleanup_only) {
			console.log("🧹 Running in cleanup-only mode...");

			if (inputs.cleanup_all_test_tags) {
				// Clean up all test artifacts with broader patterns
				await cleanupAllTestArtifacts({ token: inputs.token, repo, pattern: "test-" });
				await cleanupAllTestArtifacts({ token: inputs.token, repo, pattern: "a0" });
				await cleanupAllTestArtifacts({ token: inputs.token, repo, pattern: "a1" });
				await cleanupAllTestArtifacts({ token: inputs.token, repo, pattern: "gh0" });
				await cleanupAllTestArtifacts({ token: inputs.token, repo, pattern: "gh1" });
			} else {
				await cleanup({ token: inputs.token, repo, tag: inputs.test_tag_name });
			}

			// Set minimal outputs for cleanup-only mode
			core.setOutput("overall_result", "success");
			core.setOutput("git_result", "skipped");
			core.setOutput("api_result", "skipped");
			core.setOutput("gpg_result", "skipped");
			core.setOutput("api_gpg_result", "skipped");
			core.setOutput("git_gpg_result", "skipped");
			core.setOutput("details", JSON.stringify({ mode: "cleanup-only", completed: true }));

			console.log("✅ Cleanup completed successfully");
			return;
		}

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
			const apiGpgExpected = enableSign;
			const apiGpgActual = apiResult.apiGpgVerified || false;

			let apiGpgStatusText;
			if (!apiGpgExpected) {
				apiGpgStatusText = "not expected";
			} else if (apiGpgActual) {
				apiGpgStatusText = "verified";
			} else {
				apiGpgStatusText = "expected but not supported (GitHub Apps cannot sign via API)";
			}

			apiReleaseResult = await createRelease({
				token: inputs.token,
				repo,
				tag: inputs.test_tag_name,
				targetCommit,
				title: "Test Release (API Tag)",
				body: `Test release created for API-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${apiGpgActual}\n**GPG Signing**: ${apiGpgStatusText}`,
				suffix: "api"
			});
		}

		if (gitResult.success) {
			const gitGpgExpected = enableSign;
			const gitGpgActual = gitResult.gitGpgVerified || false;
			const signatureStatus = gitResult.signatureStatus || "unknown";

			let gpgStatusText;
			if (!gitGpgExpected) {
				gpgStatusText = "not expected";
			} else if (gitGpgActual) {
				gpgStatusText = "verified";
			} else {
				// More detailed status based on signature detection
				switch (signatureStatus) {
					case "signed but unverified":
						gpgStatusText = "signed but not verified (trust/key issues)";
						break;
					case "invalid":
						gpgStatusText = "signed but invalid";
						break;
					case "unsigned":
						gpgStatusText = "expected but not signed";
						break;
					default:
						gpgStatusText = "expected but not verified";
				}
			}

			gitReleaseResult = await createRelease({
				token: inputs.token,
				repo,
				tag: inputs.test_tag_name,
				targetCommit,
				title: "Test Release (Git Tag)",
				body: `Test release created for git-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${gitGpgActual}\n**GPG Signing**: ${gpgStatusText}\n**Signature Status**: ${signatureStatus}`,
				suffix: "git"
			});
		}

		core.setOutput("api_release_success", apiReleaseResult.success);
		core.setOutput("git_release_success", gitReleaseResult.success);

		// Set the outputs that the workflow expects
		const overallSuccess = apiResult.success && gitResult.success && apiReleaseResult.success && gitReleaseResult.success;

		core.setOutput("overall_result", overallSuccess ? "success" : "failure");
		core.setOutput("git_result", gitResult.success ? "success" : "failure");
		core.setOutput("api_result", apiResult.success ? "success" : "failure");

		// Separate GPG verification results for API and Git methods
		const apiGpgSuccess = enableSign && apiResult.apiGpgVerified;
		const gitGpgSuccess = enableSign && gitResult.gitGpgVerified;

		core.setOutput("api_gpg_result", apiGpgSuccess ? "success" : "failure");
		core.setOutput("git_gpg_result", gitGpgSuccess ? "success" : "failure");

		// Combined GPG result for backward compatibility
		core.setOutput("gpg_result", apiGpgSuccess || gitGpgSuccess ? "success" : "failure");

		const details = {
			tokenType: tokenAnalysis.type,
			apiSuccess: apiResult.success,
			gitSuccess: gitResult.success,
			apiGpgVerified: apiResult.apiGpgVerified || false,
			gitGpgVerified: gitResult.gitGpgVerified || false,
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
		console.log(
			`│ API GPG Signed:    ${enableSign ? (apiResult.apiGpgVerified ? "✅ VERIFIED" : "❌ NOT SIGNED") : "⏭️  SKIPPED"}        │`
		);
		console.log(
			`│ Git GPG Signed:    ${enableSign ? (gitResult.gitGpgVerified ? "✅ VERIFIED" : "❌ NOT SIGNED") : "⏭️  SKIPPED"}        │`
		);
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
