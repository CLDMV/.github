#!/usr/bin/env node

/**
 * Fix Unsigned Tags
 * Fixes all unsigned and lightweight tags by recreating them as signed annotated tags
 */

import { writeFileSync, unlinkSync } from "fs";
import { execFileSync } from "node:child_process";
import { gitCommand, annotatedTagArgs } from "../../utilities/git-utils.mjs";
import { debugLog } from "../../../common/common/core.mjs";
import { importGpgIfNeeded, configureGitIdentity } from "../../../github/api/_api/gpg.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";

console.log("🔍 DEBUG: Unsigned tags action starting...");

const DEBUG = process.env.INPUT_DEBUG === "true";
const DRY_RUN = process.env.INPUT_DRY_RUN === "true";
const TAGS_DETAILED = JSON.parse(process.env.INPUT_TAGS_DETAILED || "[]");
const GPG_ENABLED = (process.env.INPUT_GPG_ENABLED || "false").toLowerCase() === "true";
const TAGGER_NAME = process.env.INPUT_TAGGER_NAME || "";
const TAGGER_EMAIL = process.env.INPUT_TAGGER_EMAIL || "";
const GPG_PRIVATE_KEY = process.env.INPUT_GPG_PRIVATE_KEY || "";
const GPG_PASSPHRASE = process.env.INPUT_GPG_PASSPHRASE || "";
const GITHUB_TOKEN = process.env.INPUT_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const REPOSITORY = process.env.GITHUB_REPOSITORY || "";

/**
 * Find a release bound to `tagName`, published or draft.
 *
 * Deliberately lists releases (which includes drafts for a token with push
 * access) rather than using GET /repos/{repo}/releases/tags/{tag} — that
 * endpoint is documented to exclude drafts, and the whole point here is to
 * detect a PUBLISHED release so we can tell whether recreating this tag is
 * about to silently unpublish it.
 * @param {string} tagName - Tag name to match against `release.tag_name`.
 * @returns {Promise<object|null>} The matching release, or null if none or no token.
 */
async function findReleaseForTag(tagName) {
	if (!GITHUB_TOKEN || !REPOSITORY) return null;

	try {
		const { owner, repo } = parseRepo(REPOSITORY);
		for (let page = 1; page <= 10; page++) {
			const pageItems = await api("GET", `/releases?per_page=100&page=${page}`, null, { token: GITHUB_TOKEN, owner, repo });
			const match = pageItems.find((r) => r.tag_name === tagName);
			if (match) return match;
			if (pageItems.length < 100) break;
		}
	} catch (error) {
		debugLog(`findReleaseForTag(${tagName}) failed: ${error.message}`);
	}

	return null;
}

/**
 * Re-assert draft:false on a release after we've deleted and recreated its
 * tag. GitHub appears to treat a recreated tag object (new SHA, even when it
 * still points at the same commit) as invalidating the release's binding,
 * and silently reverts an already-published release back to draft some time
 * afterward — not instantly, and not deterministically within a single
 * immediate read. This is CI's own side effect (recreating the tag to sign
 * it), not a general draft-sweeper: a release that was genuinely left as a
 * draft is never touched, only one we're about to unpublish ourselves.
 * @param {number} releaseId - Release ID to re-publish.
 * @returns {Promise<void>}
 */
async function reassertPublished(releaseId) {
	const { owner, repo } = parseRepo(REPOSITORY);
	const maxAttempts = 6;
	const retryDelayMs = 20000;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await api("PATCH", `/releases/${releaseId}`, { draft: false }, { token: GITHUB_TOKEN, owner, repo });
			const verify = await api("GET", `/releases/${releaseId}`, null, { token: GITHUB_TOKEN, owner, repo });
			if (verify.draft !== true) {
				debugLog(`Release ${releaseId} confirmed published after tag recreation (attempt ${attempt}/${maxAttempts})`);
				return;
			}
			debugLog(`Release ${releaseId} still reads draft after re-publish attempt ${attempt}/${maxAttempts} — retrying in ${retryDelayMs}ms`);
		} catch (error) {
			debugLog(`reassertPublished(${releaseId}) attempt ${attempt}/${maxAttempts} failed: ${error.message}`);
		}
		if (attempt < maxAttempts) {
			await new Promise((r) => setTimeout(r, retryDelayMs));
		}
	}

	console.warn(`⚠️ Release ${releaseId} still reads draft after ${maxAttempts} re-publish attempts following tag recreation.`);
}

console.log(`🔍 DEBUG: Processing ${TAGS_DETAILED.length} tags for unsigned analysis`);

// Tags whose signing push was rejected. The remote tag is untouched in that case
// (we never delete it), so these are warnings, not breakage.
const failedTags = [];
// Releases this run touched, so the end-state check can confirm none was left
// as a draft and no tag went missing.
const touched = [];

/**
 * Run git with an argument vector (no shell) and capture stdout+stderr, so a
 * push rejection carries git's actual reason instead of "Command failed".
 * @param {string[]} args - git arguments.
 * @returns {{ok: boolean, output: string}} Result.
 */
function git(args) {
	try {
		const out = execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { ok: true, output: out.trim() };
	} catch (error) {
		return { ok: false, output: `${error.stdout || ""}${error.stderr || ""}`.trim() || error.message };
	}
}

/**
 * Check if a tag needs signing/annotation fixes
 * @param {object} tagObj - Tag object from detailed analysis
 * @returns {boolean} True if tag needs fixing
 */
function needsSigningFix(tagObj) {
	// If GPG is enabled, check if it needs to be annotated or signed
	if (GPG_ENABLED) {
		const needsAnnotation = !tagObj.isAnnotated;
		const needsSigning = GPG_PRIVATE_KEY && !tagObj.isSigned;
		return needsAnnotation || needsSigning;
	}
	return false;
}

/**
 * Fix an unsigned/unannotated tag
 * @param {object} tagObj - Tag object to fix
 * @returns {Promise<object|null>} Updated tag object or null if failed
 */
async function fixUnsignedTag(tagObj) {
	const tagName = tagObj.name;

	try {
		if (DRY_RUN) {
			console.log(`🔐 [DRY RUN] Would convert tag ${tagName} to signed/annotated`);

			// Return updated object for dry run
			return {
				...tagObj,
				isAnnotated: true,
				isSigned: GPG_ENABLED && GPG_PRIVATE_KEY,
				tagger: TAGGER_NAME || "github-actions[bot]"
			};
		}

		console.log(`🔐 Converting tag ${tagName} to signed/annotated tag...`);

		if (!/^[\w.@+/-]+$/.test(tagName) || tagName.startsWith("-")) {
			console.warn(`::warning::Skipping tag with an unexpected name: ${JSON.stringify(tagName)}`);
			return null;
		}

		// Get the commit this tag points to
		const commitSha = tagObj.commitSha || gitCommand(`git rev-list -n 1 ${tagName}`, true);
		if (!commitSha) {
			console.error(`❌ Could not find commit for tag ${tagName}`);
			return null;
		}

		// Use existing message or tag name as fallback
		const tagMessage = tagObj.message || tagName;

		// A release bound to this tag is about to have its tag object replaced
		// (new SHA, same commit). Capture whether it's currently published
		// BEFORE recreating, so we know afterward whether we need to correct a
		// reversion — never touch a release that's genuinely a draft.
		const existingRelease = await findReleaseForTag(tagName);
		const wasPublished = !!existingRelease && existingRelease.draft === false;
		if (existingRelease) {
			debugLog(`Tag ${tagName} is bound to release ${existingRelease.id} (draft: ${existingRelease.draft})`);
		}

		touched.push({ tagName, release: existingRelease, wasPublished });

		// Build the replacement tag object locally (replacing only the LOCAL ref).
		// The message goes through a file: it is free text and must never be
		// spliced into a shell command line.
		const msgFile = `${process.env.RUNNER_TEMP || "/tmp"}/tag-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
		writeFileSync(msgFile, tagMessage, "utf8");
		const tagArgs = annotatedTagArgs({ tagName, target: commitSha, messageFile: msgFile, sign: !!(GPG_ENABLED && GPG_PRIVATE_KEY) });
		const made = git(tagArgs);
		try {
			unlinkSync(msgFile);
		} catch {
			// best-effort temp cleanup
		}
		if (!made.ok) {
			console.warn(`::warning::Could not create the signed replacement for ${tagName}: ${made.output}`);
			failedTags.push({ tagName, reason: made.output });
			return null;
		}

		// Replace the remote ref ATOMICALLY with a force-update. Never delete it
		// first: deleting the tag behind a published release makes GitHub turn the
		// release back into a draft, and if the follow-up push is then rejected
		// (ref-lock race "reference already exists", or GitHub's App push check
		// "refusing to allow a GitHub App to create or update workflow … without
		// workflows permission" for a tag off the branch tip) the tag stays gone and
		// the release stays a draft — CLDMV/.github#362. With a force-update a
		// rejection leaves the original tag exactly where it was.
		const pushed = git(["push", "origin", `+refs/tags/${tagName}:refs/tags/${tagName}`]);
		if (!pushed.ok) {
			console.warn(
				`::warning::Could not replace ${tagName} with a signed tag; the existing tag was left unchanged. git said: ${pushed.output}`
			);
			failedTags.push({ tagName, reason: pushed.output.split("\n").find((l) => /rejected|error|fatal/i.test(l)) || pushed.output });
			return null;
		}

		console.log(`✅ Successfully converted tag ${tagName} to signed/annotated`);

		if (wasPublished) {
			console.log(`🔁 Tag ${tagName} backs a published release (${existingRelease.id}) — re-asserting it stays published...`);
			await reassertPublished(existingRelease.id);
		}

		// Return updated tag object
		return {
			...tagObj,
			isAnnotated: true,
			isSigned: GPG_ENABLED && GPG_PRIVATE_KEY,
			tagger: TAGGER_NAME || "github-actions[bot]",
			message: tagMessage
		};
	} catch (error) {
		console.error(`❌ Failed to fix tag ${tagName}: ${error.message}`);
		return null;
	}
}

// Initialize variables for summary generation
let updatedTagsDetailed;
let fixedTagsArray;

console.log("🔐 Checking and fixing unsigned/unannotated tags...");

if (TAGS_DETAILED.length === 0) {
	console.log("ℹ️ No tags to process");

	// Set outputs
	console.log("updated-tags-detailed=[]");
	console.log("fixed-count=0");
	console.log("fixed-tags=[]");

	const githubOutput = process.env.GITHUB_OUTPUT;
	if (githubOutput) {
		writeFileSync(githubOutput, "updated-tags-detailed=[]\n" + "fixed-count=0\n" + "fixed-tags=[]\n", { flag: "a" });
	}

	// Continue to summary generation instead of exiting
	updatedTagsDetailed = TAGS_DETAILED;
	fixedTagsArray = [];
	console.log("🔍 Continuing to summary generation...");
} else {
	console.log(`🔍 Analyzing ${TAGS_DETAILED.length} tags for signing/annotation issues...`);

	// Identify tags that need signing/annotation fixes
	const unsignedTags = TAGS_DETAILED.filter((tagObj) => needsSigningFix(tagObj));

	if (unsignedTags.length === 0) {
		console.log("✅ All tags are properly signed/annotated");

		// Set outputs - no changes needed
		const updatedTagsJson = JSON.stringify(TAGS_DETAILED);
		console.log(`updated-tags-detailed=${updatedTagsJson}`);
		console.log("fixed-count=0");
		console.log("fixed-tags=[]");

		const githubOutput = process.env.GITHUB_OUTPUT;
		if (githubOutput) {
			writeFileSync(githubOutput, `updated-tags-detailed=${updatedTagsJson}\n` + "fixed-count=0\n" + "fixed-tags=[]\n", { flag: "a" });
		}

		// Continue to summary generation instead of exiting
		updatedTagsDetailed = TAGS_DETAILED;
		fixedTagsArray = [];
		console.log("🔍 Continuing to summary generation...");
	} else {
		console.log(`🔧 Found ${unsignedTags.length} tags needing signing/annotation fixes:`);
		unsignedTags.forEach((tagObj) => {
			const status = [];
			if (!tagObj.isAnnotated) status.push("not annotated");
			if (!tagObj.isSigned && GPG_ENABLED && GPG_PRIVATE_KEY) status.push("not signed");
			console.log(`  - ${tagObj.name} (${status.join(", ")})`);
		});

		// Setup GPG and git identity if signing is enabled
		let keyid = "";
		if (GPG_ENABLED && GPG_PRIVATE_KEY) {
			keyid = importGpgIfNeeded({ gpg_private_key: GPG_PRIVATE_KEY, gpg_passphrase: GPG_PASSPHRASE });
			debugLog("GPG key imported", { keyid });
		}

		configureGitIdentity({
			tagger_name: TAGGER_NAME,
			tagger_email: TAGGER_EMAIL,
			keyid,
			enableSign: GPG_ENABLED && GPG_PRIVATE_KEY
		});

		// Create a copy of the detailed tags list to update
		const updatedTagsList = [...TAGS_DETAILED];
		const fixedTags = [];

		// Fix each unsigned tag
		for (const tagObj of unsignedTags) {
			const fixedTagObj = await fixUnsignedTag(tagObj);

			if (fixedTagObj) {
				// Update the tag object in the list
				const index = updatedTagsList.findIndex((t) => t.name === tagObj.name);
				if (index !== -1) {
					updatedTagsList[index] = fixedTagObj;
				}
				fixedTags.push(tagObj.name);
			}
		}

		console.log(`✅ Fixed ${fixedTags.length} unsigned/unannotated tags`);

		if (DEBUG) {
			console.log("🔍 Fixed tags details:");
			fixedTags.forEach((tagName) => {
				const tagObj = updatedTagsList.find((t) => t.name === tagName);
				if (tagObj) {
					console.log(`  - ${tagName}: annotated=${tagObj.isAnnotated}, signed=${tagObj.isSigned}`);
				}
			});
		}

		// Set variables for summary generation
		updatedTagsDetailed = updatedTagsList;
		fixedTagsArray = fixedTags;
	}
}

// End-state check: every tag this run touched must still exist on the remote,
// and every release that was published before must still be published. This is
// the loud failure the old delete-and-recreate path never had — it logged
// "Fixed 0" and exited 0 while leaving a draft release with no tag behind.
const brokenReleases = [];
if (!DRY_RUN && touched.length > 0) {
	for (const t of touched) {
		const remote = git(["ls-remote", "--tags", "origin", `refs/tags/${t.tagName}`]);
		if (!remote.ok || !remote.output) {
			brokenReleases.push(`${t.tagName}: tag is missing on the remote`);
			continue;
		}
		if (t.wasPublished && t.release?.id) {
			let current = null;
			try {
				const { owner, repo } = parseRepo(REPOSITORY);
				current = await api("GET", `/releases/${t.release.id}`, null, { token: GITHUB_TOKEN, owner, repo });
			} catch (error) {
				debugLog(`end-state read of release ${t.release.id} failed: ${error.message}`);
			}
			if (current?.draft === true) {
				console.log(`🔁 Release for ${t.tagName} reads draft after the tag update — re-publishing...`);
				await reassertPublished(t.release.id);
				try {
					const { owner, repo } = parseRepo(REPOSITORY);
					current = await api("GET", `/releases/${t.release.id}`, null, { token: GITHUB_TOKEN, owner, repo });
				} catch {
					// fall through with the previous read
				}
				if (current?.draft === true)
					brokenReleases.push(`${t.tagName}: release ${t.release.html_url || t.release.id} was published and is now a draft`);
			}
		}
	}
}

// Set outputs
const updatedTagsJson = JSON.stringify(updatedTagsDetailed);
const fixedTagsJson = JSON.stringify(fixedTagsArray);

// Create detailed summary JSON with title, description, and pre-formatted lines
const summaryData = {
	title: "🔏 Signature Analysis",
	description:
		fixedTagsArray.length > 0
			? "The following tags were converted to signed/annotated tags:"
			: "Analyzed version tags for signature compliance.",
	fixed_count: fixedTagsArray.length,
	lines: [],
	stats_template: "🔏 Unsigned tag fixes: {count}",
	notes: []
};

// Create pre-formatted lines for each fixed tag
for (const tagName of fixedTagsArray) {
	const originalTag = TAGS_DETAILED.find((t) => t.name === tagName);
	const fixedTag = updatedTagsDetailed.find((t) => t.name === tagName);

	if (originalTag && fixedTag) {
		const status = [];
		if (!originalTag.isAnnotated) status.push("was lightweight");
		if (!originalTag.isSigned) status.push("was unsigned");
		const line = `- **${tagName}** (${status.join(", ")})`;
		summaryData.lines.push(line);
	}
}

for (const f of failedTags) {
	summaryData.lines.push(
		`- ⚠️ **${f.tagName}** left unchanged (signing push rejected: ${String(f.reason)
			.replace(/[\r\n]+/g, " ")
			.slice(0, 200)})`
	);
}
for (const b of brokenReleases) {
	summaryData.lines.push(`- ❌ **${b}**`);
}

// Add appropriate notes
if (failedTags.length > 0 || brokenReleases.length > 0) {
	summaryData.notes.push(`${failedTags.length} tag(s) could not be signed; ${brokenReleases.length} release/tag problem(s) need attention`);
} else if (fixedTagsArray.length > 0) {
	summaryData.notes.push(`Successfully fixed ${fixedTagsArray.length} unsigned tag(s)`);
} else {
	summaryData.lines.push("- ✅ **No issues found**: All version tags are properly signed");
	summaryData.notes.push("All analyzed tags are already properly signed and annotated");
}

const summaryJson = JSON.stringify(summaryData);

console.log(`🔍 DEBUG: Unsigned tags action summary data:`);
console.log(JSON.stringify(summaryData, null, 2));

console.log(`updated-tags-detailed=${updatedTagsJson}`);
console.log(`fixed-count=${fixedTagsArray.length}`);
console.log(`fixed-tags=${fixedTagsJson}`);
console.log(`summary-json=${summaryJson}`);

// Write to GitHub output file
const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
	writeFileSync(
		githubOutput,
		`updated-tags-detailed=${updatedTagsJson}\n` +
			`fixed-count=${fixedTagsArray.length}\n` +
			`fixed-tags=${fixedTagsJson}\n` +
			`summary-json=${summaryJson}\n`,
		{ flag: "a" }
	);
	console.log("🔍 DEBUG: Unsigned tags action outputs written to GITHUB_OUTPUT");
} else {
	console.log("🔍 DEBUG: No GITHUB_OUTPUT file available");
}

// A refused signing push is a real error now: the job pushes with the bot App
// token, which requests the `workflows` scope (the old refusals came from the
// persisted GITHUB_TOKEN). The original tag is left untouched in that case.
for (const f of failedTags) console.error(`::error::Could not replace ${f.tagName} with a signed tag: ${f.reason}`);
if (failedTags.length > 0) process.exitCode = 1;
if (brokenReleases.length > 0) {
	for (const b of brokenReleases) console.error(`::error::${b}`);
	console.error(
		"::error::Tag health left a release unpublished or a tag missing — see CLDMV/.github#362 and repair with the sync-release-notes workflow."
	);
	process.exitCode = 1;
} else {
	console.log("🔍 DEBUG: Unsigned tags action completed successfully");
}
