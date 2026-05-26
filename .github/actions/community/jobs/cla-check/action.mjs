/**
 * @fileoverview CLA signature check for a PR against the central ledger repo.
 *
 * Resolves the active CLA scope first:
 *   - If the consumer repo has its own CLA.md, this is an OVERRIDE: the bot
 *     enforces the consumer's text and stores signatures under
 *     signatures/<platform>/overrides/<consumer-org>/<consumer-repo>/v<X.Y>/.
 *     The CLA version is read from the override file's header (e.g. the line
 *     `# ... CLA — v1.0` produces `v1.0`); the workflow's `cla_version` input
 *     is a fallback if the header can't be parsed.
 *   - Otherwise, the DEFAULT CLA text in the ledger
 *     (cla-versions/<version>.md) applies; signatures live at
 *     signatures/<platform>/v<X.Y>/<shard>/<id>.json. The version comes from
 *     the workflow `cla_version` input.
 *
 * Signatures are scoped per-CLA-text-hash — signing the default v1.0 does
 * not cover override-repo v1.0 and vice versa.
 *
 * For each unique commit author on the PR:
 *   1. Skip if the login is in `exempt_users`.
 *   2. Skip if `exempt_org_members` and the login is in `exempt_org`.
 *   3. Look up the corresponding signature file at the path for the active
 *      scope.
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

/**
 * Extract the CLA version from the file's H1 header, e.g.
 * "# CLDMV Contributor License Agreement (CLA) — v1.0" → "v1.0".
 * Returns null if no version-shaped token is present in the first
 * non-empty line.
 */
function parseVersionFromCLAHeader(text) {
	if (!text) return null;
	const firstLine = text.split("\n").find((l) => l.trim().length > 0);
	if (!firstLine) return null;
	const m = firstLine.match(/v(\d+)\.(\d+)(?:\.\d+)?\b/i);
	if (!m) return null;
	return `v${m[1]}.${m[2]}`;
}

function shardFor(id) {
	return createHash("sha256").update(String(id)).digest("hex").slice(0, 3);
}

function sha256Hex(text) {
	return createHash("sha256").update(text).digest("hex");
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

/**
 * Fetch a file's contents via the GitHub Contents API.
 * Returns { exists, text, sha256, blob_sha }; { exists: false } on 404.
 */
async function fetchFileContents({ token, owner, repo, path }) {
	try {
		const res = await api("GET", `/contents/${path}`, null, { token, owner, repo });
		if (res?.content && res.encoding === "base64") {
			const text = Buffer.from(res.content, "base64").toString("utf8");
			return { exists: true, text, sha256: sha256Hex(text), blob_sha: res.sha };
		}
		return { exists: false };
	} catch (err) {
		if (err.message.includes("404")) return { exists: false };
		throw err;
	}
}

async function ledgerHasFile({ token, ledgerRepo, path }) {
	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
	try {
		await api("GET", `/contents/${path}`, null, { token, owner: ledgerOwner, repo: ledgerName });
		return true;
	} catch (err) {
		if (err.message.includes("404")) return false;
		throw err;
	}
}

function signaturePathFor({ platform, version, userId, scope, consumerOwner, consumerRepo }) {
	const shard = shardFor(userId);
	if (scope === "override") {
		return `signatures/${platform}/overrides/${consumerOwner}/${consumerRepo}/${version}/${shard}/${userId}.json`;
	}
	return `signatures/${platform}/${version}/${shard}/${userId}.json`;
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
	const inputClaVersion = normalizeVersion(rawClaVersion);
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
	const publicClaUrlTpl =
		getInput("public_cla_url_template") ||
		"https://github.com/CLDMV/.github/blob/v4/examples/repo-seeds/.cla-signatures/cla-versions/${cla_version}.md";
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

	// --- Resolve scope, active CLA, and effective version ---
	const consumerCla = await fetchFileContents({ token, owner, repo, path: claPath });
	let scope, claVersion, activeCla, activeClaSourceLabel, activeClaPublicUrl;

	if (consumerCla.exists) {
		scope = "override";
		activeCla = consumerCla;

		const headerVersion = parseVersionFromCLAHeader(consumerCla.text);
		if (headerVersion) {
			claVersion = headerVersion;
			if (headerVersion !== inputClaVersion) {
				console.log(
					`::warning::workflow input cla_version=${inputClaVersion} doesn't match override CLA.md header ${headerVersion}; using ${headerVersion}.`
				);
			}
		} else {
			claVersion = inputClaVersion;
			console.log(`::warning::Could not parse version from override CLA.md header; using workflow input ${inputClaVersion}.`);
		}

		activeClaSourceLabel = `override (\`${owner}/${repo}/${claPath}\`)`;
		activeClaPublicUrl = `https://github.com/${owner}/${repo}/blob/${consumerCla.blob_sha}/${claPath}`;
	} else {
		scope = "default";
		claVersion = inputClaVersion;

		const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
		const defaultClaPath = `cla-versions/${claVersion}.md`;
		const ledgerCla = await fetchFileContents({ token, owner: ledgerOwner, repo: ledgerName, path: defaultClaPath });
		if (!ledgerCla.exists) {
			console.error(
				`::error::Default CLA not found at ${ledgerRepo}/${defaultClaPath} and consumer repo has no override at ${claPath}.`
			);
			process.exit(1);
		}
		activeCla = ledgerCla;
		activeClaSourceLabel = `default (\`${ledgerRepo}/${defaultClaPath}\`)`;
		activeClaPublicUrl = publicClaUrlTpl.replace("${cla_version}", claVersion);
	}

	const requiredText = textTpl.replace("${cla_version}", claVersion);
	const claHashShort = "sha256:" + activeCla.sha256.slice(0, 16);

	// --- Enumerate unique commit-authors (login + numeric ID) ---
	const commits = await getPRCommits({ token, owner, repo, prNumber });
	const authors = new Map();
	for (const c of commits) {
		const login = c.author?.login;
		const id = c.author?.id;
		if (login && id != null) {
			authors.set(login, { login, id: String(id) });
		} else {
			console.log(`::warning::Commit ${c.sha.slice(0, 7)} has no GitHub-resolved author; CLA bot can't check email-only authors.`);
		}
	}

	// --- Check signature for each author at scope-appropriate path ---
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
		const sigPath = signaturePathFor({
			platform: ledgerPlatform,
			version: claVersion,
			userId: a.id,
			scope,
			consumerOwner: owner,
			consumerRepo: repo
		});
		const signed = await ledgerHasFile({ token, ledgerRepo, path: sigPath });
		if (signed) {
			status.push({ login: a.login, state: "signed", emoji: "✅", id: a.id });
			continue;
		}
		status.push({ login: a.login, state: "missing", emoji: "❌", id: a.id });
		allCovered = false;
	}

	if (allCovered) {
		console.log(`✅ All ${authors.size} author(s) covered (${scope}).`);
		await postStatus({
			token,
			owner,
			repo,
			sha: headSha,
			state: "success",
			description: `All ${authors.size} author(s) covered (${scope})`,
			targetUrl: pr.html_url
		});
		appendSummary(
			`## ✅ CLA signature-check passed\n\nAll ${authors.size} commit author(s) are covered for ${claVersion} (${scope} CLA).`
		);
		process.exit(0);
	}

	// --- Build the request comment ---
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

	const scopeLine =
		scope === "override"
			? `This repository defines its own CLA (override): the bot enforces the text at [\`${claPath}\`](${activeClaPublicUrl}) in this repo. Signing here does **not** carry over to repos that use the org-wide default CLA.`
			: `This repository uses the org-wide default CLA. The text the bot enforces is published at [\`${claVersion}\`](${activeClaPublicUrl}). Signing once covers your future contributions to every ${owner} repository that uses the default — until the CLA's major.minor version is bumped.`;

	const body = [
		`📜 **CLA signature required**`,
		``,
		`${scopeLine}`,
		``,
		`Current version: \`${claVersion}\` (${activeClaSourceLabel}, ${claHashShort}).`,
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
		`Records are kept in the [${ledgerName}](https://github.com/${ledgerOwner}/${ledgerName}) ledger.`
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

	appendSummary(`## ❌ CLA signature-check pending (${scope} CLA)\n\n${statusList}`);
	process.exit(0);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
