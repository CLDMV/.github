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
 * Verify GPG signature on a tag using Git commands (for Git-created tags)
 * @param {string} tagName - Name of the tag to verify
 * @returns {Object} Verification result
 */
function verifyGitTagGpgSignature(tagName) {
	try {
		console.log(`🔍 Verifying GPG signature via Git for tag ${tagName}...`);

		// Try to get signature information using git show
		const gitShowOutput = gitCommand(`git show --show-signature ${tagName}`, true);
		console.log(`📄 Git show output for ${tagName}:`);

		// Truncate output to 50 lines to avoid log overflow
		const outputLines = gitShowOutput.split("\n");
		const truncatedOutput = outputLines.slice(0, 50).join("\n");
		if (outputLines.length > 50) {
			console.log(truncatedOutput);
			console.log(`... (truncated ${outputLines.length - 50} additional lines)`);
		} else {
			console.log(truncatedOutput);
		}

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
 * Verify tag via GitHub API (for API-created tags)
 * @param {string} token - Authentication token
 * @param {string} repo - Repository in owner/repo format
 * @param {string} tagName - Name of the tag to verify
 * @returns {Object} Verification result
 */
async function verifyApiTagSignature(token, repo, tagName) {
	try {
		console.log(`🔍 Verifying tag via GitHub API for ${tagName}...`);

		const { owner, repo: repoName } = parseRepo(repo);

		// First get the tag reference
		const tagRefResponse = await api("GET", `/git/refs/tags/${tagName}`, null, { token, owner, repo: repoName });

		if (!tagRefResponse) {
			throw new Error(`Tag reference ${tagName} not found via API`);
		}

		console.log(`✅ Tag reference found: ${tagRefResponse.object.sha} (type: ${tagRefResponse.object.type})`);

		// If it's a tag object (not a commit), get the actual tag object details
		let tagObjectResponse = null;
		if (tagRefResponse.object.type === "tag") {
			tagObjectResponse = await api("GET", `/git/tags/${tagRefResponse.object.sha}`, null, { token, owner, repo: repoName });

			if (tagObjectResponse) {
				console.log(`📋 Tag object details:`, {
					sha: tagObjectResponse.sha,
					tag: tagObjectResponse.tag,
					message: tagObjectResponse.message,
					tagger: tagObjectResponse.tagger,
					object: tagObjectResponse.object,
					verification: tagObjectResponse.verification
				});

				// Check if verification information is present
				const verification = tagObjectResponse.verification;
				if (verification) {
					console.log(`🔍 GitHub verification status:`, verification);
					return {
						verified: verification.verified || false,
						signed: verification.signature !== null,
						status: verification.verified ? "verified" : verification.signature ? "signed_unverified" : "unsigned",
						statusText: verification.reason || "No verification information",
						sha: tagObjectResponse.sha,
						verification: verification
					};
				} else {
					console.log(`ℹ️  No verification information in tag object`);
					return {
						verified: false,
						signed: false,
						status: "no_verification_info",
						statusText: "Tag object exists but no verification information available",
						sha: tagObjectResponse.sha,
						verification: null
					};
				}
			}
		}

		// If it's a lightweight tag (points directly to commit) or we couldn't get tag object
		console.log(`ℹ️  Tag ${tagName} is a lightweight tag or tag object unavailable`);
		return {
			verified: false, // Lightweight tags aren't signed
			signed: false,
			status: "lightweight_tag",
			statusText: "Lightweight tag - no signature information",
			sha: tagRefResponse.object.sha,
			verification: null
		};
	} catch (error) {
		console.log(`❌ API tag verification failed for ${tagName}: ${error.message}`);
		return {
			verified: false,
			signed: false,
			status: "error",
			statusText: `API verification error: ${error.message}`,
			sha: null,
			verification: null
		};
	}
}

/**
 * Test API-based tag creation
 */
async function testApiTagCreation({ token, repo, tagName, targetCommit, tagger_name, tagger_email }) {
	try {
		console.log(`🏷️ Creating tag ${tagName} via GitHub API...`);

		const { owner, repo: repoName } = parseRepo(repo);

		// Use app-derived identity for API operations (not bot secrets)
		// The app token already contains the app's identity context
		const tagData = {
			tag: tagName,
			message: `API test tag ${tagName}`,
			object: targetCommit,
			type: "commit"
			// Note: No tagger field needed - GitHub API will use the app's context
		};

		const tagResponse = await api("POST", "/git/tags", tagData, { token, owner, repo: repoName });

		if (!tagResponse) {
			throw new Error("Failed to create tag object via API");
		}

		console.log(`✅ Tag object created: ${tagResponse.sha}`);

		// Create the reference
		const refData = {
			ref: `refs/tags/${tagName}`,
			sha: tagResponse.sha
		};

		const refResponse = await api("POST", "/git/refs", refData, { token, owner, repo: repoName });

		if (!refResponse) {
			throw new Error("Failed to create tag reference via API");
		}

		console.log(`✅ Tag reference created: ${refResponse.ref}`);

		// Verify the tag using API verification (not git commands)
		const verification = await verifyApiTagSignature(token, repo, tagName);

		console.log(`🔍 API Tag verification result:`, {
			verified: verification.verified,
			signed: verification.signed,
			status: verification.status,
			statusText: verification.statusText
		});

		return {
			success: true,
			tagSha: tagResponse.sha,
			refSha: refResponse.object.sha,
			verification
		};
	} catch (error) {
		console.log(`❌ API tag creation failed: ${error.message}`);
		return {
			success: false,
			error: error.message,
			verification: { verified: false, signed: false, status: "error" }
		};
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

		const { owner, repo: repoName } = parseRepo(repo);
		const releaseResponse = await api(
			"POST",
			`/releases`,
			{
				tag_name: tag,
				target_commitish: targetCommit,
				name: `${title} (${suffix})`,
				body: body,
				draft: false,
				prerelease: true
			},
			{ token, owner, repo: repoName }
		);

		if (releaseResponse) {
			console.log(`✅ GitHub release created: ${releaseResponse.html_url}`);
			return {
				success: true,
				id: releaseResponse.id,
				url: releaseResponse.html_url,
				author: releaseResponse.author?.login || "unknown"
			};
		} else {
			throw new Error(`Release creation failed: No response`);
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

		// Delete the tag locally (may not exist in CI environment)
		try {
			gitCommand(`git tag -d ${tag}`, true);
			console.log(`✅ Local tag ${tag} deleted`);
		} catch (error) {
			// This is normal in CI - tags may not exist locally
			console.log(`ℹ️  Local tag ${tag} not found (normal in CI)`);
		}

		// Delete the tag remotely (this is the important one)
		try {
			console.log(`🔍 Attempting to delete remote tag: ${tag}`);
			const gitPushResult = gitCommand(`git push origin :refs/tags/${tag}`, true);
			console.log(`✅ Remote tag ${tag} deleted successfully`);
			console.log(`📄 Git push output: ${gitPushResult}`);
		} catch (error) {
			console.log(`ℹ️  Remote tag ${tag} deletion failed: ${error.message}`);
			console.log(`📄 This might be because the tag doesn't exist remotely or permission issues`);

			// Try alternative method via GitHub API
			try {
				console.log(`🔄 Trying to delete tag via GitHub API...`);
				const { owner, repo: repoName } = parseRepo(repo);
				await api("DELETE", `/git/refs/tags/${tag}`, null, { token, owner, repo: repoName });
				console.log(`✅ Remote tag ${tag} deleted via API`);
			} catch (apiError) {
				console.log(`⚠️  API tag deletion also failed: ${apiError.message}`);
			}
		}

		// Delete any associated releases (most important for cleanup)
		try {
			const { owner, repo: repoName } = parseRepo(repo);
			console.log(`🔍 Fetching releases for ${owner}/${repoName}...`);
			const releasesResponse = await api("GET", `/releases`, null, { token, owner, repo: repoName });

			console.log(`📋 Total releases found: ${releasesResponse?.length || 0}`);

			// Look for releases with matching tag name
			const matchingReleases = releasesResponse.filter((release) => release.tag_name === tag);

			if (matchingReleases.length === 0) {
				console.log(`ℹ️  No releases found for tag ${tag}`);
			} else {
				console.log(`🎯 Found ${matchingReleases.length} releases to delete for tag ${tag}`);
				for (const release of matchingReleases) {
					console.log(`🗑️  Deleting release: "${release.name}" (ID: ${release.id}, Tag: ${release.tag_name})`);
					const deleteResult = await api("DELETE", `/releases/${release.id}`, null, { token, owner, repo: repoName });
					console.log(`✅ Release "${release.name}" (${tag}) deleted successfully`);
				}
			}
		} catch (error) {
			console.log(`⚠️  Release cleanup failed for tag ${tag}: ${error.message}`);
			console.log(`📄 Error details:`, error);
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

		// Get all local tags
		let tags = [];
		let testReleases = []; // Move declaration outside try block

		try {
			const tagsOutput = gitCommand("git tag --list", true);
			tags = tagsOutput.split("\n").filter((tag) => tag.trim() && tag.includes(pattern));
			console.log(`📋 Found ${tags.length} local tags matching pattern`);
		} catch (error) {
			console.log(`ℹ️  Could not get local tags: ${error.message}`);
		}

		// Also get all GitHub releases and find test releases
		try {
			const { owner, repo: repoName } = parseRepo(repo);
			console.log(`🔍 Fetching all releases from ${owner}/${repoName}...`);
			const releasesResponse = await api("GET", `/releases`, null, { token, owner, repo: repoName });

			console.log(`📋 Total releases in repository: ${releasesResponse?.length || 0}`);

			// Look for releases with test patterns (covers more cases than just local tags)
			const testPatterns = [
				"test-debug", // main pattern
				"a00-", // test matrix patterns
				"a01-",
				"a10-",
				"a11-",
				"gh0-",
				"gh1-"
			];

			// Show all release tag names for debugging
			console.log(
				`🔍 All release tags:`,
				releasesResponse.map((r) => r.tag_name)
			);

			// Find test releases by TWO criteria:
			// 1. Tag name patterns (for releases with tags)
			// 2. Release title patterns (for orphaned releases without tags)
			const testReleasesByTag = releasesResponse.filter(
				(release) => release.tag_name && testPatterns.some((pattern) => release.tag_name.includes(pattern))
			);

			const testReleasesByTitle = releasesResponse.filter((release) => release.name && release.name.startsWith("Test Release ("));

			// Combine both lists, avoiding duplicates
			const allTestReleaseIds = new Set();
			testReleases = [];

			for (const release of [...testReleasesByTag, ...testReleasesByTitle]) {
				if (!allTestReleaseIds.has(release.id)) {
					allTestReleaseIds.add(release.id);
					testReleases.push(release);
				}
			}

			console.log(`📋 DEBUG: Pattern matching results:`);
			console.log(`  - Test patterns: ${JSON.stringify(testPatterns)}`);
			console.log(`  - Total releases: ${releasesResponse.length}`);
			console.log(`  - Releases by tag pattern: ${testReleasesByTag.length}`);
			console.log(`  - Releases by title pattern: ${testReleasesByTitle.length}`);
			console.log(`  - Combined unique test releases: ${testReleases.length}`);

			console.log(`📋 Found ${testReleases.length} test releases to clean up:`);
			testReleases.forEach((release) => {
				console.log(`  - "${release.name}" (tag: ${release.tag_name || "NO TAG"}, id: ${release.id})`);
			});

			// Add release tags to our cleanup list if they're not already there
			for (const release of testReleases) {
				if (release.tag_name && !tags.includes(release.tag_name)) {
					tags.push(release.tag_name);
				}
			}
		} catch (error) {
			console.log(`ℹ️  Could not get releases for cleanup: ${error.message}`);
			console.log(`📄 Error details:`, error);
		}

		console.log(`🎯 Total items to clean up: ${tags.length}`);
		console.log(`🔍 DEBUG: testReleases array length: ${testReleases.length}`);
		console.log(`🔍 DEBUG: About to check if testReleases.length > 0: ${testReleases.length > 0}`);

		// First, delete all test releases directly (don't rely on tag-based cleanup)
		if (testReleases.length > 0) {
			console.log(`🗑️  Deleting ${testReleases.length} test releases directly...`);
			const { owner, repo: repoName } = parseRepo(repo);

			for (const release of testReleases) {
				try {
					console.log(`🗑️  Deleting release: "${release.name}" (ID: ${release.id}, Tag: ${release.tag_name})`);
					await api("DELETE", `/releases/${release.id}`, null, { token, owner, repo: repoName });
					console.log(`✅ Release "${release.name}" deleted successfully`);
				} catch (error) {
					console.log(`⚠️  Failed to delete release "${release.name}": ${error.message}`);
				}
			}
		}

		// Now check for orphaned tags (tags that exist but don't have releases)
		console.log(`🔍 Checking for orphaned tags...`);
		const { owner, repo: repoName } = parseRepo(repo);

		try {
			// Get all remote tags
			const allTagsResponse = await api("GET", `/git/refs/tags`, null, { token, owner, repo: repoName });
			console.log(`📋 Total remote tags found: ${allTagsResponse?.length || 0}`);

			if (allTagsResponse && allTagsResponse.length > 0) {
				// Test patterns for orphaned tag cleanup
				const testPatterns = [
					"test-debug", // main pattern
					"a00-", // test matrix patterns
					"a01-",
					"a10-",
					"a11-",
					"gh0-",
					"gh1-"
				];

				const orphanedTestTags = allTagsResponse.filter((tagRef) => {
					const tagName = tagRef.ref.replace("refs/tags/", "");
					return testPatterns.some((pattern) => tagName.includes(pattern));
				});

				console.log(`📋 Found ${orphanedTestTags.length} orphaned test tags to clean up:`);
				orphanedTestTags.forEach((tagRef) => {
					const tagName = tagRef.ref.replace("refs/tags/", "");
					console.log(`  - ${tagName} (ref: ${tagRef.ref})`);
				});

				// Delete orphaned test tags
				for (const tagRef of orphanedTestTags) {
					const tagName = tagRef.ref.replace("refs/tags/", "");
					try {
						console.log(`🗑️  Deleting orphaned tag: ${tagName}`);
						await api("DELETE", `/git/${tagRef.ref}`, null, { token, owner, repo: repoName });
						console.log(`✅ Orphaned tag "${tagName}" deleted successfully`);
					} catch (error) {
						console.log(`⚠️  Failed to delete orphaned tag "${tagName}": ${error.message}`);
					}
				}
			}
		} catch (error) {
			console.log(`ℹ️  Could not check for orphaned tags: ${error.message}`);
		}

		// Then clean up each tag (this will also attempt release cleanup as backup)
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
 * Nuclear cleanup - delete ALL test releases and tags, regardless of local tag state
 */
async function nuclearCleanupTestArtifacts({ token, repo }) {
	try {
		console.log(`☢️  NUCLEAR CLEANUP: Removing ALL test artifacts from repository...`);

		const { owner, repo: repoName } = parseRepo(repo);

		// Get ALL releases
		console.log(`🔍 Fetching all releases from ${owner}/${repoName}...`);
		const allReleases = await api("GET", `/releases`, null, { token, owner, repo: repoName });
		console.log(`📋 Total releases found: ${allReleases?.length || 0}`);

		// Define comprehensive test patterns
		const testPatterns = [
			"test-debug", // main pattern
			"test-v", // test version pattern
			"a00-", // test matrix patterns
			"a01-",
			"a10-",
			"a11-",
			"gh0-",
			"gh1-",
			"-api", // API tag suffix
			"-git" // Git tag suffix
		];

		// Find ALL test releases
		const testReleases = allReleases.filter((release) => testPatterns.some((pattern) => release.tag_name.includes(pattern)));

		console.log(`🎯 Found ${testReleases.length} test releases to DELETE:`);
		testReleases.forEach((release) => {
			console.log(`  💣 "${release.name}" (tag: ${release.tag_name}, id: ${release.id})`);
		});

		// Delete ALL test releases
		let deletedReleases = 0;
		for (const release of testReleases) {
			try {
				console.log(`🗑️  DELETING: "${release.name}" (${release.tag_name})`);
				await api("DELETE", `/releases/${release.id}`, null, { token, owner, repo: repoName });
				deletedReleases++;
				console.log(`✅ DELETED: "${release.name}"`);
			} catch (error) {
				console.log(`❌ FAILED to delete "${release.name}": ${error.message}`);
			}
		}

		// Get ALL tags from GitHub API (not local git)
		console.log(`🔍 Fetching all tags from GitHub API...`);
		const allTagRefs = await api("GET", `/git/refs/tags`, null, { token, owner, repo: repoName });
		console.log(`📋 Total tag refs found: ${allTagRefs?.length || 0}`);

		// Find test tags
		const testTagRefs = allTagRefs.filter((tagRef) => testPatterns.some((pattern) => tagRef.ref.includes(pattern)));

		console.log(`🎯 Found ${testTagRefs.length} test tag refs to DELETE:`);
		testTagRefs.forEach((tagRef) => {
			console.log(`  💣 ${tagRef.ref}`);
		});

		// Delete ALL test tags via API
		let deletedTags = 0;
		for (const tagRef of testTagRefs) {
			try {
				const tagName = tagRef.ref.replace("refs/tags/", "");
				console.log(`🗑️  DELETING TAG: ${tagName}`);
				await api("DELETE", tagRef.ref.replace("refs/", "/git/refs/"), null, { token, owner, repo: repoName });
				deletedTags++;
				console.log(`✅ DELETED TAG: ${tagName}`);
			} catch (error) {
				console.log(`❌ FAILED to delete tag ${tagRef.ref}: ${error.message}`);
			}
		}

		console.log(`☢️  NUCLEAR CLEANUP COMPLETE:`);
		console.log(`   💥 Releases deleted: ${deletedReleases}/${testReleases.length}`);
		console.log(`   💥 Tags deleted: ${deletedTags}/${testTagRefs.length}`);

		return {
			success: true,
			releasesDeleted: deletedReleases,
			tagsDeleted: deletedTags,
			totalFound: testReleases.length + testTagRefs.length
		};
	} catch (error) {
		console.log(`☢️  NUCLEAR CLEANUP FAILED: ${error.message}`);
		console.log(`📄 Error details:`, error);
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
			gpg_tagger_name: core.getInput("gpg_tagger_name"),
			gpg_tagger_email: core.getInput("gpg_tagger_email"),
			cleanup_all_test_artifacts: core.getInput("cleanup_all_test_artifacts") === "true",
			nuclear_cleanup: core.getInput("nuclear_cleanup") === "true"
		};

		const repo = parseRepo(process.env.GITHUB_REPOSITORY);
		const repoString = `${repo.owner}/${repo.repo}`;
		const targetCommit = inputs.target_commit;

		console.log(`🎯 Target commit: ${targetCommit}`);
		console.log(`🏷️  Test tag name: ${inputs.test_tag_name}`);

		// Analyze token
		const tokenAnalysis = analyzeToken(inputs.token, inputs.use_github_token);
		console.log(`🔐 Token analysis: ${JSON.stringify(tokenAnalysis, null, 2)}`);

		// If cleanup_only is true, just do cleanup and exit
		if (inputs.cleanup_only) {
			console.log("🧹 Cleanup-only mode enabled");
			console.log(`🔍 Cleanup inputs check:`);
			console.log(`  - cleanup_all_test_tags: ${inputs.cleanup_all_test_tags}`);
			console.log(`  - cleanup_all_test_artifacts: ${inputs.cleanup_all_test_artifacts}`);
			console.log(`  - nuclear_cleanup: ${inputs.nuclear_cleanup}`);

			if (inputs.nuclear_cleanup) {
				console.log("☢️  STARTING NUCLEAR CLEANUP (DELETE ALL TEST ARTIFACTS)...");
				await nuclearCleanupTestArtifacts({
					token: inputs.token,
					repo: repoString
				});
			} else if (inputs.cleanup_all_test_tags || inputs.cleanup_all_test_artifacts) {
				console.log("✅ Starting comprehensive cleanup...");
				await cleanupAllTestArtifacts({
					token: inputs.token,
					repo: repoString,
					pattern: "test-debug"
				});
			} else {
				console.log("⚠️  No cleanup flags enabled, skipping cleanup");
			}
			return;
		}

		// Setup Git configuration using bot secrets (not app-derived identity)
		console.log("\n🔧 Setting up Git configuration with bot secrets...");
		const { enableSign, keyid } = setupGitConfig({
			tagger_name: inputs.gpg_tagger_name || inputs.tagger_name, // Use GPG-specific name if provided, fallback to regular
			tagger_email: inputs.gpg_tagger_email || inputs.tagger_email, // Use GPG-specific email if provided, fallback to regular
			gpg_private_key: inputs.gpg_private_key,
			gpg_passphrase: inputs.gpg_passphrase,
			token: inputs.token,
			repo: repoString
		});

		console.log(`🔐 GPG signing enabled: ${enableSign}`);

		// Test API tag creation (no Git setup needed - uses app token)
		console.log("\n🔗 Testing API-based tag creation...");
		const apiTagName = `${inputs.test_tag_name}-api`;
		const apiResult = await testApiTagCreation({
			token: inputs.token,
			repo: repoString,
			tagName: apiTagName,
			targetCommit,
			tagger_name: inputs.tagger_name,
			tagger_email: inputs.tagger_email
		});

		// Test API GPG verification if API tag was created
		let apiGpgVerified = false;
		if (apiResult.success && apiResult.verification) {
			// API tags already have verification results from testApiTagCreation
			apiGpgVerified = apiResult.verification.verified;
			console.log(`🔍 API tag verification: ${apiResult.verification.statusText}`);
		}

		// Test Git tag creation (separate tag name to avoid conflicts)
		console.log("\n⚡ Testing Git-based tag creation...");
		const gitTagName = `${inputs.test_tag_name}-git`;
		const gitResult = await testGitTagCreation({
			tagName: gitTagName,
			targetCommit,
			enableSign
		});

		// Test Git GPG verification if Git tag was created
		let gitGpgVerified = false;
		if (gitResult.success) {
			const gitGpgResult = verifyGitTagGpgSignature(gitTagName);
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
			repo: repoString,
			tag: apiTagName,
			targetCommit,
			title: "Test Release (API Tag)",
			body: `Test release created for API-based tag.\n\n**Token Type**: ${tokenAnalysis.type}\n**Tag Verified**: ${
				apiGpgVerified ? "✅ Verified" : "❌ Not verified"
			}\n**GPG Signing**: API tags do not support GPG signing`,
			suffix: "api"
		});

		const gitReleaseResult = await createRelease({
			token: inputs.token,
			repo: repoString,
			tag: gitTagName,
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
		core.setOutput("api_gpg_result", "not_supported"); // API tags cannot be GPG signed
		core.setOutput("git_gpg_result", enableSign && gitGpgVerified ? "success" : "failure");
		core.setOutput("gpg_result", enableSign && gitGpgVerified ? "success" : "failure"); // Only Git supports GPG
		core.setOutput("token_type", tokenAnalysis.type);
		core.setOutput("api_tag_verified", apiGpgVerified); // This is verification, not signing
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
		console.log(`│ API GPG Signed:    ${"❌ NOT SUPPORTED".padEnd(29)} │`);
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
		if (inputs.cleanup_all_test_tags || inputs.cleanup_all_test_artifacts) {
			await cleanupAllTestArtifacts({
				token: inputs.token,
				repo: repoString,
				pattern: "test-debug"
			});
		} else if (inputs.cleanup_tag) {
			// Cleanup both API and Git tags
			await cleanup({
				token: inputs.token,
				repo: repoString,
				tag: apiTagName
			});
			await cleanup({
				token: inputs.token,
				repo: repoString,
				tag: gitTagName
			});
		}
	} catch (error) {
		console.error(`💥 Action failed: ${error.message}`);
		core.setFailed(error.message);
	}
}

// Execute the action
run();
