/**
 * @fileoverview Handle issue_comment:created on a PR — if the comment is a
 * valid CLA acceptance, record the signature in the central ledger repo
 * (default: CLDMV/.cla-signatures).
 *
 * For each event:
 *   1. Validate the comment matches the required text for the current
 *      CLA major.minor.
 *   2. Validate the commenter is one of the PR's commit authors.
 *   3. Build the full signature record per the ledger schema.
 *   4. Idempotency: if a record already exists for this (signer, version),
 *      skip the write and post an acknowledgment linking to it.
 *   5. Otherwise PUT a new file via the GitHub Contents API and post the
 *      acknowledgment comment.
 *
 * @module @cldmv/.github.community.jobs.cla-record
 */

import { createHash } from "node:crypto";
import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

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

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value && typeof value === "object") {
		const out = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = canonicalize(value[key]);
		}
		return out;
	}
	return value;
}

function computeSignatureId(record) {
	const { signature_id: _ignored, ...rest } = record;
	const canonical = JSON.stringify(canonicalize(rest));
	return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

function isGitHubNoreply(email) {
	return /@users\.noreply\.github\.com$/i.test(email || "");
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

async function fetchUserProfile({ token, login }) {
	try {
		return await api("GET", `/users/${encodeURIComponent(login)}`, null, { token, owner: null, repo: null });
	} catch (err) {
		console.log(`::warning::Could not fetch profile for @${login}: ${err.message}`);
		return null;
	}
}

async function ledgerGet({ token, ledgerRepo, path }) {
	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
	try {
		return await api("GET", `/contents/${path}`, null, { token, owner: ledgerOwner, repo: ledgerName });
	} catch (err) {
		if (err.message.includes("404")) return null;
		throw err;
	}
}

async function ledgerPut({ token, ledgerRepo, path, content, message, committer }) {
	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
	const body = {
		message,
		content: Buffer.from(content, "utf8").toString("base64")
	};
	if (committer?.name && committer?.email) {
		body.committer = { name: committer.name, email: committer.email };
		body.author = { name: committer.name, email: committer.email };
	}
	return await api("PUT", `/contents/${path}`, body, { token, owner: ledgerOwner, repo: ledgerName });
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
	const textTpl = getInput("required_text_template") || "I have read and I agree to the CLA ${cla_version}";
	const ledgerRepo = getInput("ledger_repo") || "CLDMV/.cla-signatures";
	const ledgerPlatform = getInput("ledger_platform") || "github";
	const token = getInput("github_token", { required: true });

	const taggerName = process.env.TAGGER_NAME || "";
	const taggerEmail = process.env.TAGGER_EMAIL || "";

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	const workflowRef = process.env.GITHUB_WORKFLOW_REF || "";
	const workflowRunId = process.env.GITHUB_RUN_ID || "";
	const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
	const workflowRunUrl = workflowRunId ? `${serverUrl}/${repository}/actions/runs/${workflowRunId}` : "";

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
		console.log(`ℹ️ Comment doesn't match required text for ${claVersion}; skipping.`);
		process.exit(0);
	}

	const prNumber = issue.number;
	const signerLogin = comment.user?.login;
	const signerId = comment.user?.id;
	if (!signerLogin || signerId == null) {
		console.log(`::warning::Comment is missing user identity; skipping.`);
		process.exit(0);
	}
	const commentUrl = comment.html_url;
	const commentId = comment.id;
	const commentCreatedAt = comment.created_at;
	const commentUpdatedAt = comment.updated_at;

	// Fetch PR + commits + signer profile + CLA in parallel
	const [pr, prCommits, signerProfile, claRes] = await Promise.all([
		api("GET", `/pulls/${prNumber}`, null, { token, owner, repo }),
		getPRCommits({ token, owner, repo, prNumber }),
		fetchUserProfile({ token, login: signerLogin }),
		api("GET", `/contents/${claPath}`, null, { token, owner, repo }).catch(() => null)
	]);

	// Validate that signer is a PR commit author
	const signerIsAuthor = prCommits.some((c) => c.author?.id === signerId);
	if (!signerIsAuthor) {
		console.log(`::warning::@${signerLogin} is not a commit author on PR #${prNumber}; ignoring.`);
		process.exit(0);
	}

	// Build commit metadata for this signer
	const commitEmails = [];
	const signedCommits = [];
	for (const c of prCommits) {
		const authorId = c.author?.id;
		const committerId = c.committer?.id;
		if (authorId === signerId) {
			const email = c.commit?.author?.email || "";
			if (email) {
				commitEmails.push({
					email,
					role: "author",
					commit_sha: c.sha,
					verified_on_account: true,
					github_noreply: isGitHubNoreply(email)
				});
			}
		}
		if (committerId === signerId && committerId !== authorId) {
			const email = c.commit?.committer?.email || "";
			if (email) {
				commitEmails.push({
					email,
					role: "committer",
					commit_sha: c.sha,
					verified_on_account: true,
					github_noreply: isGitHubNoreply(email)
				});
			}
		}
		if ((authorId === signerId || committerId === signerId) && c.commit?.verification) {
			const v = c.commit.verification;
			signedCommits.push({
				sha: c.sha,
				verified: Boolean(v.verified),
				reason: v.reason || ""
			});
		}
	}

	// CLA hash + commit-pinned URL
	let claSha256 = "";
	let claUrlAtSigning = "";
	if (claRes?.content && claRes.encoding === "base64") {
		const text = Buffer.from(claRes.content, "base64").toString("utf8");
		claSha256 = "sha256:" + createHash("sha256").update(text).digest("hex");
		if (claRes.sha) {
			claUrlAtSigning = `${serverUrl}/${repository}/blob/${claRes.sha}/${claPath}`;
		}
	}

	const nowIso = new Date().toISOString();

	// Build the signature record (schema_version 1)
	const record = {
		schema_version: 1,
		signer: {
			platform: ledgerPlatform,
			platform_user_id: String(signerId),
			platform_node_id: signerProfile?.node_id || "",
			github_login_at_signing: signerLogin,
			profile_url_at_signing: signerProfile?.html_url || `${serverUrl}/${signerLogin}`,
			account_type: signerProfile?.type || "User",
			account_created_at: signerProfile?.created_at || "",
			commit_emails: commitEmails,
			signed_commits_in_pr: signedCommits
		},
		agreement: {
			cla_version: claVersion,
			cla_path: claPath,
			cla_sha256: claSha256,
			cla_url_at_signing: claUrlAtSigning,
			required_text: requiredText,
			comment_body_verbatim: comment.body || ""
		},
		context: {
			consumer_repo: repository,
			pr_number: prNumber,
			pr_title: pr.title || "",
			pr_url: pr.html_url || `${serverUrl}/${repository}/pull/${prNumber}`,
			pr_base_ref: pr.base?.ref || "",
			pr_head_sha_at_signing: pr.head?.sha || "",
			pr_commit_shas_at_signing: prCommits.map((c) => c.sha)
		},
		source: {
			comment_id: commentId,
			comment_url: commentUrl,
			comment_created_at: commentCreatedAt,
			comment_updated_at: commentUpdatedAt
		},
		bot: {
			github_app_slug: process.env.GITHUB_APP_SLUG || "",
			workflow_ref: workflowRef,
			workflow_run_id: workflowRunId,
			workflow_run_url: workflowRunUrl,
			recorded_at: nowIso
		}
	};
	record.signature_id = computeSignatureId(record);

	const shard = shardFor(signerId);
	const ledgerPath = `signatures/${ledgerPlatform}/${claVersion}/${shard}/${signerId}.json`;

	// Idempotency: existing record for this (signer, version)?
	const existing = await ledgerGet({ token, ledgerRepo, path: ledgerPath });
	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");
	const ledgerFileUrl = `${serverUrl}/${ledgerOwner}/${ledgerName}/blob/HEAD/${ledgerPath}`;

	if (existing) {
		console.log(`ℹ️ Signature already on file for @${signerLogin} ${claVersion}; skipping write.`);
		await api(
			"POST",
			`/issues/${prNumber}/comments`,
			{
				body: [
					`✅ @${signerLogin} — your CLA signature for **${claVersion}** is already on file.`,
					``,
					`It applies to all your contributions across ${owner} repositories until the CLA's major.minor version is bumped — no need to re-sign.`
				].join("\n")
			},
			{ token, owner, repo }
		);
		await postStatus({
			token,
			owner,
			repo,
			sha: pr.head?.sha,
			state: "success",
			description: `@${signerLogin} signature on file for ${claVersion}`,
			targetUrl: pr.html_url
		});
		appendSummary(`✅ CLA signature for @${signerLogin} ${claVersion} already recorded — no-op.`);
		process.exit(0);
	}

	// Write the new signature file
	const commitMessage = `chore(cla): record @${signerLogin} signature for ${claVersion}`;
	const content = JSON.stringify(record, null, "\t") + "\n";
	try {
		await ledgerPut({
			token,
			ledgerRepo,
			path: ledgerPath,
			content,
			message: commitMessage,
			committer: { name: taggerName, email: taggerEmail }
		});
		console.log(`✅ Wrote signature to ${ledgerRepo}:${ledgerPath}`);
	} catch (err) {
		console.error(`::error::Failed to write signature to ledger: ${err.message}`);
		await api(
			"POST",
			`/issues/${prNumber}/comments`,
			{
				body: `⚠️ Failed to record CLA signature for @${signerLogin} in the [${ledgerName}](${serverUrl}/${ledgerOwner}/${ledgerName}) ledger (${err.message}). Your acceptance comment at ${commentUrl} stands as the legal record; we'll retry on the next CLA bot run.`
			},
			{ token, owner, repo }
		);
		process.exit(1);
	}

	// Post acknowledgment on the PR. This is the contributor's self-contained
	// receipt — the ledger repo is private, so the signature_id + CLA hash
	// captured here are the contributor's verifiable record.
	const receiptLines = [
		`✅ Recorded CLA signature for @${signerLogin} — **${claVersion}**.`,
		``,
		`This signature applies to all your future contributions across ${owner} repositories until the CLA's major.minor version is bumped — you won't be asked to sign again.`,
		``,
		`<details><summary>Receipt — keep this comment for your records</summary>`,
		``,
		`| Field | Value |`,
		`| --- | --- |`,
		`| Signature ID | \`${record.signature_id}\` |`,
		`| CLA version | \`${claVersion}\` |`,
		`| CLA SHA-256 | \`${claSha256 || "(not captured)"}\` |`,
		`| Signed at | \`${commentCreatedAt}\` |`,
		`| Contribution | ${repository} #${prNumber} (head \`${(pr.head?.sha || "").slice(0, 12)}\`) |`,
		`| Comment | ${commentUrl} |`,
		``,
		`The full signature record is stored in an internal CLDMV ledger; this comment is your contributor-facing copy.`,
		`</details>`
	];
	await api(
		"POST",
		`/issues/${prNumber}/comments`,
		{ body: receiptLines.join("\n") },
		{ token, owner, repo }
	);

	await postStatus({
		token,
		owner,
		repo,
		sha: pr.head?.sha,
		state: "success",
		description: `@${signerLogin} signature recorded for ${claVersion}`,
		targetUrl: pr.html_url
	});

	appendSummary(`✅ CLA signature recorded for @${signerLogin} on PR #${prNumber} (ledger: \`${ledgerPath}\`).`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
