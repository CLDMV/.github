/**
 * @fileoverview Handle issue_comment:created on a PR — if the comment is a
 * valid CLA acceptance, record the signature in the central ledger repo
 * (default: CLDMV/.cla-signatures).
 *
 * Resolves scope before recording:
 *   - If the consumer repo has its own CLA.md, this is an OVERRIDE. The bot
 *     reads the consumer's text + parses the version from its header. The
 *     signature lives at
 *     signatures/<platform>/overrides/<consumer-org>/<consumer-repo>/v<X.Y>/<shard>/<id>.json.
 *
 *     First-signer bootstrap: the bot writes the consumer's text to
 *     cla-versions/overrides/<consumer-org>/<consumer-repo>/v<X.Y>.md
 *     (along with the .sha256). That snapshot is immutable — never updated
 *     after creation.
 *
 *     Drift detection: if a snapshot already exists for this scope+version,
 *     the bot compares its SHA against the consumer's current CLA.md SHA.
 *     A mismatch means the consumer edited their CLA.md without bumping the
 *     version; the bot fails loudly with a clear remediation message.
 *
 *   - Otherwise, the DEFAULT CLA in the ledger applies. The bot uses the
 *     workflow `cla_version` input and reads cla-versions/<version>.md.
 *     Signature lives at signatures/<platform>/v<X.Y>/<shard>/<id>.json.
 *
 * In both cases, `cla_url_at_signing` is a commit-pinned URL into the
 * ledger pointing at the exact snapshot the signature is bound to.
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

/**
 * Fetch a file via the Contents API. Returns { exists, text, sha256, blob_sha }
 * or { exists: false } on 404.
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

/**
 * Return the SHA of the most recent commit that touched `path` in the given
 * repo, or null if no commit history is available.
 */
async function getLastCommitForPath({ token, owner, repo, path }) {
	try {
		const commits = await api("GET", `/commits?path=${encodeURIComponent(path)}&per_page=1`, null, { token, owner, repo });
		return Array.isArray(commits) && commits.length > 0 ? commits[0].sha : null;
	} catch (err) {
		if (err.message.includes("404")) return null;
		throw err;
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
	const textTpl = getInput("required_text_template") || "I have read and I agree to the CLA ${cla_version}";
	const ledgerRepo = getInput("ledger_repo") || "CLDMV/.cla-signatures";
	const ledgerPlatform = getInput("ledger_platform") || "github";
	const token = getInput("github_token", { required: true });

	const taggerName = process.env.TAGGER_NAME || "";
	const taggerEmail = process.env.TAGGER_EMAIL || "";
	const committer = taggerName && taggerEmail ? { name: taggerName, email: taggerEmail } : null;

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	const workflowRef = process.env.GITHUB_WORKFLOW_REF || "";
	const workflowRunId = process.env.GITHUB_RUN_ID || "";
	const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
	const workflowRunUrl = workflowRunId ? `${serverUrl}/${repository}/actions/runs/${workflowRunId}` : "";
	const [ledgerOwner, ledgerName] = ledgerRepo.split("/");

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

	// --- Fetch PR, commits, signer profile, and consumer CLA (parallel) ---
	const [pr, prCommits, signerProfile, consumerCla] = await Promise.all([
		api("GET", `/pulls/${prNumber}`, null, { token, owner, repo }),
		getPRCommits({ token, owner, repo, prNumber }),
		fetchUserProfile({ token, login: signerLogin }),
		fetchFileContents({ token, owner, repo, path: claPath })
	]);

	// --- Resolve scope, active CLA, effective version ---
	let scope, claVersion, activeCla, activeClaPathInLedger;

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

		activeClaPathInLedger = `cla-versions/overrides/${owner}/${repo}/${claVersion}.md`;
	} else {
		scope = "default";
		claVersion = inputClaVersion;

		const defaultClaPath = `cla-versions/${claVersion}.md`;
		const ledgerCla = await fetchFileContents({ token, owner: ledgerOwner, repo: ledgerName, path: defaultClaPath });
		if (!ledgerCla.exists) {
			console.error(
				`::error::Default CLA not found at ${ledgerRepo}/${defaultClaPath} and consumer repo has no override at ${claPath}.`
			);
			process.exit(1);
		}
		activeCla = ledgerCla;
		activeClaPathInLedger = defaultClaPath;
	}

	// --- Validate the comment matches the required-text for the effective version ---
	const requiredText = textTpl.replace("${cla_version}", claVersion);
	const requiredRegex = new RegExp(`^\\s*${escapeRegex(requiredText)}\\s*$`, "m");
	if (!requiredRegex.test(comment.body || "")) {
		console.log(`ℹ️ Comment doesn't match required text for ${claVersion} (${scope}); skipping.`);
		process.exit(0);
	}

	// --- Validate signer is a PR commit author ---
	const signerIsAuthor = prCommits.some((c) => c.author?.id === signerId);
	if (!signerIsAuthor) {
		console.log(`::warning::@${signerLogin} is not a commit author on PR #${prNumber}; ignoring.`);
		process.exit(0);
	}

	// --- For OVERRIDE scope: check or bootstrap the immutable snapshot ---
	let bootstrapCommitSha = null;
	if (scope === "override") {
		const snapshot = await ledgerGet({ token, ledgerRepo, path: activeClaPathInLedger });
		if (snapshot) {
			// Existing snapshot — verify the consumer's CLA hasn't drifted.
			const snapshotText = Buffer.from(snapshot.content, "base64").toString("utf8");
			const snapshotSha256 = sha256Hex(snapshotText);
			if (snapshotSha256 !== consumerCla.sha256) {
				const driftMessage = [
					`❌ CLA drift detected for @${signerLogin}'s acceptance on PR #${prNumber}.`,
					``,
					`This repository's \`${claPath}\` text has changed since the ${claVersion} snapshot was archived in the ledger. Once a version is signed by anyone, its text is frozen.`,
					``,
					`Either:`,
					`1. **Revert** the change to \`${claPath}\` so it matches the archived ${claVersion} (sha256:${snapshotSha256.slice(0, 16)}…), or`,
					`2. **Bump** the version in \`${claPath}\`'s header (e.g. \`v1.0\` → \`v1.1\`). The bot will archive the new text as a fresh snapshot on the next signature.`,
					``,
					`Current \`${claPath}\` sha256: \`sha256:${consumerCla.sha256.slice(0, 16)}…\``,
					`Archived \`${claVersion}\` sha256: \`sha256:${snapshotSha256.slice(0, 16)}…\``,
					``,
					`This signature is **not recorded** until the drift is resolved.`
				].join("\n");
				console.error(`::error::CLA drift for ${owner}/${repo} ${claVersion}: consumer text sha256 doesn't match ledger snapshot.`);
				await api("POST", `/issues/${prNumber}/comments`, { body: driftMessage }, { token, owner, repo });
				await postStatus({
					token,
					owner,
					repo,
					sha: pr.head?.sha,
					state: "failure",
					description: `CLA drift: ${claPath} doesn't match ${claVersion} snapshot`,
					targetUrl: pr.html_url
				});
				process.exit(1);
			}
		} else {
			// First signer for this (override-repo, version) — bootstrap the snapshot.
			const bootstrapMsg = `chore(cla): bootstrap override snapshot for ${owner}/${repo} ${claVersion}`;
			const mdRes = await ledgerPut({
				token,
				ledgerRepo,
				path: activeClaPathInLedger,
				content: consumerCla.text,
				message: bootstrapMsg,
				committer
			});
			bootstrapCommitSha = mdRes?.commit?.sha || null;
			// Companion .sha256 file
			const shaPath = activeClaPathInLedger.replace(/\.md$/, ".sha256");
			await ledgerPut({
				token,
				ledgerRepo,
				path: shaPath,
				content: `sha256:${consumerCla.sha256}\n`,
				message: bootstrapMsg.replace(".md", ".sha256"),
				committer
			});
			console.log(`✅ Bootstrapped override snapshot at ${ledgerRepo}:${activeClaPathInLedger}`);
		}
	}

	// --- Compute cla_url_at_signing (commit-pinned into the ledger) ---
	const ledgerCommitSha =
		bootstrapCommitSha ||
		(await getLastCommitForPath({ token, owner: ledgerOwner, repo: ledgerName, path: activeClaPathInLedger }));
	const claUrlAtSigning = ledgerCommitSha
		? `${serverUrl}/${ledgerOwner}/${ledgerName}/blob/${ledgerCommitSha}/${activeClaPathInLedger}`
		: `${serverUrl}/${ledgerOwner}/${ledgerName}/blob/HEAD/${activeClaPathInLedger}`;

	// --- Build commit metadata for this signer ---
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

	const nowIso = new Date().toISOString();

	// --- Build the signature record (schema_version 1) ---
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
			cla_scope: scope,
			cla_path_in_ledger: activeClaPathInLedger,
			cla_sha256: `sha256:${activeCla.sha256}`,
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

	// --- Determine signature path based on scope ---
	const shard = shardFor(signerId);
	const signaturePath =
		scope === "override"
			? `signatures/${ledgerPlatform}/overrides/${owner}/${repo}/${claVersion}/${shard}/${signerId}.json`
			: `signatures/${ledgerPlatform}/${claVersion}/${shard}/${signerId}.json`;

	// --- Idempotency: existing record for this (signer, scope, version)? ---
	const existing = await ledgerGet({ token, ledgerRepo, path: signaturePath });
	if (existing) {
		console.log(`ℹ️ Signature already on file for @${signerLogin} (${scope} ${claVersion}); skipping write.`);
		await api(
			"POST",
			`/issues/${prNumber}/comments`,
			{
				body: [
					`✅ @${signerLogin} — your CLA signature for **${claVersion}** (${scope}) is already on file.`,
					``,
					scope === "override"
						? `It applies to your contributions to this repository (\`${repository}\`) until the override CLA's major.minor version is bumped — no need to re-sign here.`
						: `It applies to all your contributions across ${owner} repositories that use the default CLA until the major.minor version is bumped — no need to re-sign.`
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
		appendSummary(`✅ CLA signature for @${signerLogin} ${claVersion} (${scope}) already recorded — no-op.`);
		process.exit(0);
	}

	// --- Write the new signature file ---
	const commitMessage =
		scope === "override"
			? `chore(cla): record @${signerLogin} signature for ${owner}/${repo} ${claVersion} (override)`
			: `chore(cla): record @${signerLogin} signature for ${claVersion}`;
	const content = JSON.stringify(record, null, "\t") + "\n";
	try {
		await ledgerPut({
			token,
			ledgerRepo,
			path: signaturePath,
			content,
			message: commitMessage,
			committer
		});
		console.log(`✅ Wrote signature to ${ledgerRepo}:${signaturePath}`);
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

	// --- Post acknowledgment on the PR (contributor's self-contained receipt) ---
	const scopeReceiptLine =
		scope === "override"
			? `This signature covers your contributions to \`${repository}\` (override CLA) until the override's major.minor version is bumped — you won't be asked to sign again here.`
			: `This signature applies to all your future contributions across ${owner} repositories that use the default CLA, until the CLA's major.minor version is bumped — you won't be asked to sign again.`;

	const receiptLines = [
		`✅ Recorded CLA signature for @${signerLogin} — **${claVersion}** (${scope}).`,
		``,
		scopeReceiptLine,
		``,
		`<details><summary>Receipt — keep this comment for your records</summary>`,
		``,
		`| Field | Value |`,
		`| --- | --- |`,
		`| Signature ID | \`${record.signature_id}\` |`,
		`| Scope | \`${scope}\` |`,
		`| CLA version | \`${claVersion}\` |`,
		`| CLA SHA-256 | \`sha256:${activeCla.sha256}\` |`,
		`| Signed at | \`${commentCreatedAt}\` |`,
		`| Contribution | ${repository} #${prNumber} (head \`${(pr.head?.sha || "").slice(0, 12)}\`) |`,
		`| Comment | ${commentUrl} |`,
		``,
		`The full signature record is stored in an internal CLDMV ledger; this comment is your contributor-facing copy.`,
		`</details>`
	];
	await api("POST", `/issues/${prNumber}/comments`, { body: receiptLines.join("\n") }, { token, owner, repo });

	await postStatus({
		token,
		owner,
		repo,
		sha: pr.head?.sha,
		state: "success",
		description: `@${signerLogin} signature recorded for ${claVersion}`,
		targetUrl: pr.html_url
	});

	appendSummary(`✅ CLA signature recorded for @${signerLogin} on PR #${prNumber} (${scope} ${claVersion}; ledger: \`${signaturePath}\`).`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
