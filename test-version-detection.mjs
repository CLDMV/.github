#!/usr/bin/env node

/**
 * Test script for changelog generation using REAL functions
 * ESM script that tests the changelog generation logic and identifies bugs
 */

import {
	findReleaseCommits,
	analyzeVersionBump,
	extractExplicitVersion
} from "./.github/actions/git/steps/check-release-commit/action.mjs";
import { categorizeCommits } from "./.github/actions/git/steps/get-commit-range/action.mjs";
import { generateComprehensiveChangelog } from "./.github/actions/git/steps/generate-comprehensive-changelog/action.mjs";

console.log("🧪 Testing Real Changelog Generation");
console.log("====================================");
console.log("✅ Functions imported successfully");

// Test data that reproduces the issue - includes a release! commit that should NOT appear in changelog
const testCommitData = `760c1b361448629d208e74c957ad7fa5aa202558|chore(ci): remove unused input parameters from publish workflow|Nate - CLDMV|2025-09-10 08:49:27 -0700
4fe9f4e7c84da7b87d47b617624e47c5dfe58e49|ci: update minimum Node.js version to 16.4 in CI workflows|Nate - CLDMV|2025-09-10 08:40:34 -0700
d44ee976ae4a434fd72f495148c0661c398df3d2|ci: remove unnecessary input parameters from CI workflows|Nate - CLDMV|2025-09-10 08:10:41 -0700
959addb09ce1a4d45e2a9967577c27c6b5dbf4c1|ci(update-tags): remove commented package_name requirement|Nate - CLDMV|2025-09-10 07:56:08 -0700
41255715fe2e0a534acd8581ad515a53397c6b0f|feat(ci, publish, release): add configurable Node.js and build options|Nate - CLDMV|2025-09-10 07:45:26 -0700
4c3a4640de4da3bd0a58f86a5f86fa4eab2238df|chore(release): refine commit detection logic for release PRs|Nate - CLDMV|2025-09-09 15:48:38 -0700
94ec5fe1a67574e72c6907b494fe55b0d5e68a36|chore(release): update minimum Node.js version for matrix testing|Nate - CLDMV|2025-09-09 15:42:36 -0700
176afd386c2cf32322c40c9ea16b23e255218ba3|ci(release): Fix the release detection logic in workflow|Nate - CLDMV|2025-09-09 15:39:53 -0700
e337498fbfacc3c92a83858e89c93f6b020fae01|chore(tests): remove deprecated test scripts for doclet processing|Nate - CLDMV|2025-09-09 15:08:06 -0700
c1f6778226503ce6ec1e749aae05b7dcf9a5a0a3|release: v2.0.1 - Fix workflow authentication and GPG signing|Nate - CLDMV|2025-09-09 11:59:19 -0700`;

console.log("\n📋 Testing with real commit data:");

// Test categorizeCommits function with the raw data
try {
	console.log("\n🔍 Testing categorizeCommits() with raw commit data...");

	// categorizeCommits returns a flat array of commits with categorization
	const allCommits = categorizeCommits("v2.0.0..HEAD", testCommitData);
	console.log("All commits:", JSON.stringify(allCommits, null, 2));

	console.log("\n📋 All commits for analysis:", allCommits.length);
	allCommits.forEach((commit) => {
		console.log(`  ${commit.hash}: ${commit.subject} [${commit.category}]${commit.isBreaking ? " 💥" : ""}`);
	});

	console.log("\n🔍 Testing findReleaseCommits()...");
	const releaseAnalysis = findReleaseCommits(allCommits);
	console.log("Release Analysis:", JSON.stringify(releaseAnalysis, null, 2));

	console.log("\n🔍 Testing analyzeVersionBump()...");
	const versionAnalysis = analyzeVersionBump(allCommits);
	console.log("Version Analysis:", JSON.stringify(versionAnalysis, null, 2));

	console.log("\n📊 Summary:");
	if (versionAnalysis.versionBump === "explicit" && versionAnalysis.explicitVersion === "2.0.1") {
		console.log("✅ SUCCESS: Explicit version 2.0.1 detected correctly");
	} else {
		console.log("❌ FAILURE: Expected explicit version 2.0.1");
		console.log(`   Got: ${versionAnalysis.versionBump} / ${versionAnalysis.explicitVersion}`);
	}

	// Test explicit version extraction directly
	console.log("\n🔍 Testing extractExplicitVersion() directly...");
	const releaseSubject = "release: v2.0.1 - Fix workflow authentication and GPG signing";
	const explicitVersion = extractExplicitVersion(releaseSubject);
	console.log(`Input: "${releaseSubject}"`);
	console.log(`Extracted version: "${explicitVersion}"`);

	// Now test the changelog generation
	console.log("\n📝 Testing Changelog Generation");
	console.log("================================");

	const changelog = generateComprehensiveChangelog("v2.0.0..HEAD", allCommits);
	console.log("Generated changelog:");
	console.log(changelog);

	// Check for the specific issue
	// const hasReleaseInChangelog = changelog.includes("release:");
	// console.log(`\n🔍 Issue Check: Release commits in changelog: ${hasReleaseInChangelog ? "❌ YES (BUG!)" : "✅ NO"}`);

	// if (hasReleaseInChangelog) {
	// 	console.log("🐛 PROBLEM: Release commits should NOT appear in changelog content!");
	// 	console.log("   The bug is in the breaking changes section - it matches ANY commit with '!'");
	// 	console.log("   This includes 'release!:' commits which should be filtered out.");
	// }
} catch (error) {
	console.error("❌ Error testing functions:", error.message);
	console.error(error.stack);
}
