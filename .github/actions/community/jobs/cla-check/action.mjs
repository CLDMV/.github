/**
 * @fileoverview CLA signature check for a PR.
 * For each unique commit author:
 *   1. Skip if author is in exempt_users
 *   2. Skip if author is an org member (when exempt_org_members)
 *   3. Look for valid signature (PR comment by the author matching required_text)
 * If any author is missing a signature: post (or edit) a request comment +
 * mark status check failure. Otherwise: clear status check, no comment.
 * Batch 1.1.
 * @module @cldmv/.github.community.jobs.cla-check
 */

import { createHash } from "node:crypto";
import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

const REQUEST_COMMENT_MARKER = "<!-- cla-bot-request -->";

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function isOrgMember({ token, org, login }) {
	try {
		await api("GET", `/orgs/${org}/members/${encodeURIComponent(login)}`, null, { token, owner: null, repo: null });
		return true;
	} catch (err) {
		if (err.message.includes("404") || err.message.includes("302")) return false;
		throw err;
	}
}

async function getPRCommits({ token, owner, repo, prNumber }) {
	const commits = [];
	let page = 1;
	while (page <= 10) {
		const batch = await api("GET", `/pulls/${prNumber}/commits?per_page=100&page=${page}`, null, { token, owner, repo });
		if (!Array.isArray(batch) || batch.length === 0) break;
		commits.push(...batch);
		if (batch.length < 100) break;
		page++;
	}
	return commits;
}

async function getPRComments({ token, owner, repo, prNumber }) {
	const comments = [];
	let page = 1;
	while (page <= 10) {
		const batch = await api("GET", `/issues/${prNumber}/comments?per_page=100&page=${page}`, null, { token, owner, repo });
		if (!Array.isArray(batch) || batch.length === 0) break;
		comments.push(...batch);
		if (batch.length < 100) break;
		page++;
	}
	return comments;
}

async function postOrUpdateRequestComment({ token, owner, repo, prNumber, body }) {
	const comments = await getPRComments({ token, owner, repo, prNumber });
	const prior = comments.find((c) => c.body?.includes(REQUEST_COMMENT_MARKER));
	const full = `${REQUEST_COMMENT_MARKER}\n${body}`;
	if (prior) {
		await api("PATCH", `/issues/comments/${prior.id}`, { body: full }, { token, owner, repo });
		console.log(`💬 Updated existing CLA request comment #${prior.id}`);
	} else {
		await api("POST", `/issues/${prNumber}/comments`, { body: full }, { token, owner, repo });
		console.log(`💬 Posted new CLA request comment`);
	}
}

async function postStatus({ token, owner, repo, sha, state, description, targetUrl }) {
	await api(
		"POST",
		`/statuses/${sha}`,
		{
			state, // success | pending | error | failure
			description: description.slice(0, 140),
			target_url: targetUrl,
			context: "CLA / signature-check"
		},
		{ token, owner, repo }
	);
}

try {
	const claVersion = getInput("cla_version", { required: true });
	const claPath = getInput("cla_path") || "CLA.md";
	const exemptList = (getInput("exempt_users") || "").split(",").map((s) => s.trim()).filter(Boolean);
	const exemptOrgMembers = (getInput("exempt_org_members") || "true").toLowerCase() === "true";
	const exemptOrg = getInput("exempt_org") || process.env.GITHUB_REPOSITORY_OWNER || "";
	const textTpl = getInput("required_text_template") || "I have read and I agree to the CLA v${cla_version}";
	const token = getInput("github_token", { required: true });

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");

	const eventPath = process.env.GITHUB_EVENT_PATH;
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
	const pr = event.pull_request;
	if (!pr) {
		console.log("ℹ️ No pull_request in event; skipping.");
		process.exit(0);
	}
	const prNumber = pr.number;
	const headSha = pr.head.sha;

	const requiredText = textTpl.replace("${cla_version}", claVersion);
	const requiredRegex = new RegExp(`^\\s*${escapeRegex(requiredText)}\\s*$`, "m");

	// Compute CLA hash for display
	let claHash = "";
	try {
		const claRes = await api("GET", `/contents/${claPath}`, null, { token, owner, repo });
		if (claRes?.content && claRes.encoding === "base64") {
			const text = Buffer.from(claRes.content, "base64").toString("utf8");
			claHash = "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 16);
		}
	} catch {}

	// Enumerate unique commit-authors
	const commits = await getPRCommits({ token, owner, repo, prNumber });
	const authors = new Map(); // login → { login, id, email }
	for (const c of commits) {
		const login = c.author?.login;
		if (login) {
			authors.set(login, { login, id: c.author.id, email: c.commit?.author?.email || "" });
		} else if (c.commit?.author?.email) {
			// Best-effort fallback: no GitHub user matched; skip from CLA enforcement.
			console.log(`::warning::Commit ${c.sha.slice(0, 7)} has no GitHub-resolved author; CLA bot can't check email-only authors.`);
		}
	}

	// Get PR comments once for signature lookups
	const comments = await getPRComments({ token, owner, repo, prNumber });

	const status = [];
	let allCovered = true;
	for (const a of authors.values()) {
		// Exempt-bot check
		if (exemptList.includes(a.login)) {
			status.push({ login: a.login, state: "exempt-bot", emoji: "✅" });
			continue;
		}
		// Org-member check
		if (exemptOrgMembers && exemptOrg) {
			if (await isOrgMember({ token, org: exemptOrg, login: a.login })) {
				status.push({ login: a.login, state: "org-member", emoji: "✅" });
				continue;
			}
		}
		// Signature comment check
		const signed = comments.find((c) => c.user?.login === a.login && requiredRegex.test(c.body || ""));
		if (signed) {
			status.push({ login: a.login, state: "signed", emoji: "✅", commentUrl: signed.html_url });
			continue;
		}
		status.push({ login: a.login, state: "missing", emoji: "❌" });
		allCovered = false;
	}

	const claUrl = `https://github.com/${owner}/${repo}/blob/HEAD/${claPath}`;

	if (allCovered) {
		console.log(`✅ All ${authors.size} author(s) covered.`);
		await postStatus({
			token, owner, repo, sha: headSha,
			state: "success",
			description: `All ${authors.size} author(s) covered`,
			targetUrl: pr.html_url
		});
		appendSummary(`## ✅ CLA signature-check passed\n\nAll ${authors.size} commit author(s) are covered.`);
		process.exit(0);
	}

	// Build request comment
	const statusList = status.map((s) => {
		const label = s.state === "exempt-bot" ? "exempt (bot)"
			: s.state === "org-member" ? "covered by org membership"
			: s.state === "signed" ? `signed → [comment](${s.commentUrl})`
			: "CLA signature required";
		return `- @${s.login} — ${s.emoji} ${label}`;
	}).join("\n");

	const missingLogins = status.filter((s) => s.state === "missing").map((s) => `@${s.login}`).join(", ");
	const body = [
		`📜 **CLA signature required**`,
		``,
		`By contributing to this repo you agree to our [Contributor License Agreement](${claUrl}) (current version: \`v${claVersion}\`${claHash ? `, ${claHash}` : ""}).`,
		``,
		`Each listed signer must reply on this PR with exactly:`,
		``,
		"```",
		requiredText,
		"```",
		``,
		`### Signature status`,
		``,
		statusList,
		``,
		`> Required signers: ${missingLogins}`
	].join("\n");

	await postOrUpdateRequestComment({ token, owner, repo, prNumber, body });
	await postStatus({
		token, owner, repo, sha: headSha,
		state: "failure",
		description: `Missing signatures from ${missingLogins.slice(0, 100)}`,
		targetUrl: pr.html_url
	});

	appendSummary(`## ❌ CLA signature-check pending\n\n${statusList}`);
	// Exit 0 — the status check is the alert, not the workflow exit code.
	process.exit(0);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
