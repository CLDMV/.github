/**
 * @fileoverview Handle issue_comment:created on a PR — if it's a valid
 * CLA acceptance, record the signature. Same-repo PRs get an empty
 * signed commit on the branch with CLA-* trailers; fork PRs get an
 * acknowledgment comment (since the bot can't push to the fork).
 * Batch 1.1.
 * @module @cldmv/.github.community.jobs.cla-record
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sh(cmd) {
	console.log(`$ ${cmd}`);
	return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

try {
	const claVersion = getInput("cla_version", { required: true });
	const claPath = getInput("cla_path") || "CLA.md";
	const textTpl = getInput("required_text_template") || "I have read and I agree to the CLA v${cla_version}";
	const token = getInput("github_token", { required: true });

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");

	const eventPath = process.env.GITHUB_EVENT_PATH;
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

	const issue = event.issue;
	const comment = event.comment;
	if (!issue || !comment) {
		console.log("ℹ️ Not an issue_comment event; skipping.");
		process.exit(0);
	}
	if (!issue.pull_request) {
		console.log("ℹ️ Comment is on an issue (not PR); skipping.");
		process.exit(0);
	}
	if (issue.state !== "open") {
		console.log("ℹ️ PR is not open; skipping.");
		process.exit(0);
	}

	const requiredText = textTpl.replace("${cla_version}", claVersion);
	const requiredRegex = new RegExp(`^\\s*${escapeRegex(requiredText)}\\s*$`, "m");
	if (!requiredRegex.test(comment.body || "")) {
		console.log(`ℹ️ Comment doesn't match required text; skipping.`);
		process.exit(0);
	}

	const prNumber = issue.number;
	const signer = comment.user?.login;
	const signerId = comment.user?.id;
	const commentUrl = comment.html_url;

	// Fetch PR for head ref + fork detection
	const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
	const isFork = pr.head?.repo?.fork === true || pr.head?.repo?.full_name !== `${owner}/${repo}`;
	const headRef = pr.head?.ref;

	// Validate that signer is one of the PR's commit authors
	let page = 1;
	let signerIsAuthor = false;
	while (page <= 10 && !signerIsAuthor) {
		const batch = await api("GET", `/pulls/${prNumber}/commits?per_page=100&page=${page}`, null, { token, owner, repo });
		if (!Array.isArray(batch) || batch.length === 0) break;
		if (batch.some((c) => c.author?.login === signer)) signerIsAuthor = true;
		if (batch.length < 100) break;
		page++;
	}
	if (!signerIsAuthor) {
		console.log(`::warning::@${signer} is not a commit author on PR #${prNumber}; ignoring.`);
		process.exit(0);
	}

	// Compute CLA hash for the record
	let claHash = "";
	try {
		const claRes = await api("GET", `/contents/${claPath}`, null, { token, owner, repo });
		if (claRes?.content && claRes.encoding === "base64") {
			const text = Buffer.from(claRes.content, "base64").toString("utf8");
			claHash = "sha256:" + createHash("sha256").update(text).digest("hex");
		}
	} catch {}

	const nowIso = new Date().toISOString();

	if (!isFork && headRef) {
		// Same-repo PR: create empty signed commit on the branch
		try {
			sh(`git config user.name "${process.env.TAGGER_NAME || "CLDMV Bot"}"`);
			sh(`git config user.email "${process.env.TAGGER_EMAIL || "bot@cldmv.net"}"`);
			sh(`git fetch origin ${headRef}`);
			sh(`git checkout ${headRef}`);
			const remoteUrl = `https://x-access-token:${token}@github.com/${repository}.git`;
			sh(`git remote set-url origin "${remoteUrl}"`);

			const messageLines = [
				`chore(cla): record CLA signature from @${signer}`,
				``,
				`CLA-Signed-By: @${signer}`,
				`CLA-Signer-Id: ${signerId}`,
				`CLA-Version: ${claVersion}`,
				claHash ? `CLA-Hash: ${claHash}` : "",
				`CLA-Agreed-At: ${nowIso}`,
				`CLA-Source-Comment: ${commentUrl}`
			].filter(Boolean);

			// Escape quotes for shell
			const msgArg = messageLines.join("\n").replace(/"/g, '\\"');
			sh(`git commit --allow-empty -m "${msgArg}"`);
			sh(`git push origin ${headRef}`);
			console.log(`✅ Signature commit pushed to ${headRef}`);

			// Also post an acknowledgment so the contributor sees confirmation
			await api(
				"POST",
				`/issues/${prNumber}/comments`,
				{
					body: `✅ Recorded CLA signature for @${signer} ([source](${commentUrl})). A signed commit with the record was pushed to \`${headRef}\`.`
				},
				{ token, owner, repo }
			);
			appendSummary(`✅ CLA signature recorded for @${signer} on PR #${prNumber} (signed commit on \`${headRef}\`).`);
		} catch (err) {
			console.error(`::error::Failed to push signature commit: ${err.message}`);
			// Fall through to comment-only acknowledgment
			await api(
				"POST",
				`/issues/${prNumber}/comments`,
				{
					body: `⚠️ Failed to push signature commit to \`${headRef}\` (${err.message}). Your CLA acceptance comment at ${commentUrl} is still the legal record.`
				},
				{ token, owner, repo }
			);
			process.exit(1);
		}
	} else {
		// Fork PR — can't push to the fork branch. Comment is the record.
		console.log(`ℹ️ PR is from a fork; recording via acknowledgment comment only.`);
		await api(
			"POST",
			`/issues/${prNumber}/comments`,
			{
				body: `✅ Recorded CLA signature for @${signer} (fork PR — your acceptance comment at ${commentUrl} is the legal record).\n\n<sub>CLA-Signed-By: @${signer} • CLA-Version: ${claVersion} • CLA-Agreed-At: ${nowIso}</sub>`
			},
			{ token, owner, repo }
		);
		appendSummary(`✅ CLA signature recorded for @${signer} on fork PR #${prNumber} (acknowledgment comment).`);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
