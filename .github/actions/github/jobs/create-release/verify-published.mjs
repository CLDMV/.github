#!/usr/bin/env node

/**
 * Final gate for create-release: fail the job unless the release is actually
 * published (not a draft, unless a draft was requested) and its tag ref exists.
 *
 * The release/create step already enforces draft:false, but a release can still
 * end up as an untagged draft (tag missing or deleted after creation), and
 * before this gate the job reported success regardless. Retries briefly to ride
 * out read-after-write lag before declaring failure.
 *
 * Env: GITHUB_TOKEN, REPOSITORY, RELEASE_ID, TAG_NAME, WANT_DRAFT
 */

import { api, parseRepo } from "../../api/_api/core.mjs";

const token = process.env.GITHUB_TOKEN || "";
const { owner, repo } = parseRepo(process.env.REPOSITORY || process.env.GITHUB_REPOSITORY || "");
const releaseId = process.env.RELEASE_ID || "";
const tagName = process.env.TAG_NAME || "";
const wantDraft = String(process.env.WANT_DRAFT || "false").toLowerCase() === "true";

if (!releaseId) {
	console.error("::error::create-release produced no release id — the GitHub Release was not created.");
	process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let problems = [];
for (let attempt = 1; attempt <= 4; attempt++) {
	problems = [];
	try {
		const rel = await api("GET", `/releases/${releaseId}`, null, { token, owner, repo });
		if (!wantDraft && rel.draft) problems.push(`release ${rel.html_url || releaseId} is a draft`);
		if (rel.tag_name !== tagName) problems.push(`release is bound to tag "${rel.tag_name}", expected "${tagName}"`);
	} catch (e) {
		problems.push(`cannot read release ${releaseId}: ${e.message}`);
	}
	try {
		await api("GET", `/git/ref/tags/${encodeURIComponent(tagName)}`, null, { token, owner, repo });
	} catch (e) {
		problems.push(`tag ${tagName} does not exist (${e.message.split(":")[0]})`);
	}
	if (problems.length === 0) break;
	if (attempt < 4) await sleep(10000);
}

if (problems.length > 0) {
	for (const p of problems) console.error(`::error::${p}`);
	process.exit(1);
}
console.log(`✅ Release ${tagName} is ${wantDraft ? "a draft (as requested)" : "published"} and its tag exists.`);
