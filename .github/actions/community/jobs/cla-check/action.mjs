/**
 * @fileoverview CLA signature check for a PR against the central ledger repo.
 *
 * For each unique commit author on the PR:
 *   1. Skip if the login is in `exempt_users`.
 *   2. Skip if `exempt_org_members` and the login is in `exempt_org`.
 *   3. Look up the corresponding signature file in the ledger repo
 *      (default: CLDMV/.cla-signatures) at:
 *         signatures/<platform>/<version>/<shard>/<id>.json
 *      where <version> is the current CLA major.minor and <shard> is the
 *      first three hex chars of sha256(<id>).
 *
 * If any author lacks a signature: post (or update) a request comment and
 * set the status check to failure. Otherwise: clear the status check.
 *
 * @module @cldmv/.github.community.jobs.cla-check
 */

import { createHash } from "node:crypto";
import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

const REQUEST_COMMENT_MARKER = "<!-- cla-bot-request -->";
const STATUS_CONTEXT = "CLA / signature-check";

function normalizeVersion(v) {
	const cleaned = String(v).trim().replace(/^v/i, "");
	const parts = cleaned.split(".");
	const major = parts[0] || "0";
	const minor = parts[1] || "0";
	return `v${major}.${minor}`;
}

function shardFor(id) {
	return createHash("sha256").update(String(id)).digest("hex").slice(0, 3);
}

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

async function ledgerHasSignature({ token, ledgerRepo, platform, version, userId }) {
	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
	const shard = shardFor(userId);
	const path = `signatures/${platform}/${version}/${shard}/${userId}.json`;
	try {
		await api("GET", `/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, null, {
			token,
			owner: ledgerOwner,
			repo: ledgerName
		});
		return true;
	} catch (err) {
		if (err.message.includes("404")) return false;
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
			state,
			description: description.slice(0, 140),
			target_url: targetUrl,
			context: STATUS_CONTEXT
		},
		{ token, owner, repo }
	);
}

try {
	const rawClaVersion = getInput("cla_version", { required: true });
	const claVersion = normalizeVersion(rawClaVersion);
	const claPath = getInput("cla_path") || "CLA.md";
	const exemptList = (getInput("exempt_users") || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const exemptOrgMembers = (getInput("exempt_org_members") || "true").toLowerCase() === "true";
	const exemptOrg = getInput("exempt_org") || process.env.GITHUB_REPOSITORY_OWNER || "";
	const textTpl = getInput("required_text_template") || "I have read and I agree to the CLA ${cla_version}";
	const ledgerRepo = getInput("ledger_repo") || "CLDMV/.cla-signatures";
	const ledgerPlatform = getInput("ledger_platform") || "github";
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

	// Compute CLA hash for display in the request comment
	let claHashShort = "";
	try {
		const claRes = await api("GET", `/contents/${claPath}`, null, { token, owner, repo });
		if (claRes?.content && claRes.encoding === "base64") {
			const text = Buffer.from(claRes.content, "base64").toString("utf8");
			claHashShort = "sha256:" + createHash("sha256").update(text).digest("hex").slice(0, 16);
		}
	} catch {
		// Non-fatal: hash is just for display
	}

	// Enumerate unique commit-authors (login + numeric ID)
	const commits = await getPRCommits({ token, owner, repo, prNumber });
	const authors = new Map(); // login → { login, id }
	for (const c of commits) {
		const login = c.author?.login;
		const id = c.author?.id;
		if (login && id != null) {
			authors.set(login, { login, id: String(id) });
		} else {
			console.log(`::warning::Commit ${c.sha.slice(0, 7)} has no GitHub-resolved author; CLA bot can't check email-only authors.`);
		}
	}

	const status = [];
	let allCovered = true;
	for (const a of authors.values()) {
		if (exemptList.includes(a.login)) {
			status.push({ login: a.login, state: "exempt-bot", emoji: "✅" });
			continue;
		}
		if (exemptOrgMembers && exemptOrg) {
			if (await isOrgMember({ token, org: exemptOrg, login: a.login })) {
				status.push({ login: a.login, state: "org-member", emoji: "✅" });
				continue;
			}
		}
		const signed = await ledgerHasSignature({
			token,
			ledgerRepo,
			platform: ledgerPlatform,
			version: claVersion,
			userId: a.id
		});
		if (signed) {
			status.push({ login: a.login, state: "signed", emoji: "✅", id: a.id });
			continue;
		}
		status.push({ login: a.login, state: "missing", emoji: "❌", id: a.id });
		allCovered = false;
	}

	const claUrl = `https://github.com/${owner}/${repo}/blob/HEAD/${claPath}`;

	if (allCovered) {
		console.log(`✅ All ${authors.size} author(s) covered.`);
		await postStatus({
			token,
			owner,
			repo,
			sha: headSha,
			state: "success",
			description: `All ${authors.size} author(s) covered`,
			targetUrl: pr.html_url
		});
		appendSummary(`## ✅ CLA signature-check passed\n\nAll ${authors.size} commit author(s) are covered for ${claVersion}.`);
		process.exit(0);
	}

	// Build the request comment
	const statusList = status
		.map((s) => {
			const label =
				s.state === "exempt-bot"
					? "exempt (bot)"
					: s.state === "org-member"
						? "covered by org membership"
						: s.state === "signed"
							? `signed for ${claVersion} (ledger record on file)`
							: "CLA signature required";
			return `- @${s.login} — ${s.emoji} ${label}`;
		})
		.join("\n");

	const missingLogins = status
		.filter((s) => s.state === "missing")
		.map((s) => `@${s.login}`)
		.join(", ");

	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
	const body = [
		`📜 **CLA signature required**`,
		``,
		`By contributing to this repo you agree to our [Contributor License Agreement](${claUrl}) (current version: \`${claVersion}\`${claHashShort ? `, ${claHashShort}` : ""}).`,
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
		`> Required signers: ${missingLogins}`,
		``,
		`Signing once for ${claVersion} covers all your future contributions to every ${owner} repository until the CLA's major.minor version is bumped. Records are kept in the [${ledgerName}](https://github.com/${ledgerOwner}/${ledgerName}) ledger.`
	].join("\n");

	await postOrUpdateRequestComment({ token, owner, repo, prNumber, body });
	await postStatus({
		token,
		owner,
		repo,
		sha: headSha,
		state: "failure",
		description: `Missing signatures from ${missingLogins.slice(0, 100)}`,
		targetUrl: pr.html_url
	});

	appendSummary(`## ❌ CLA signature-check pending\n\n${statusList}`);
	process.exit(0);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
