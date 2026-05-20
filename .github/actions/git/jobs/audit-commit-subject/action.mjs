/**
 * @fileoverview Audit a commit's subject line against allowed patterns;
 * if none match, file (or skip if already-filed) a GitHub Issue with the
 * offending SHA, subject, and expected patterns. Workflow exits 0 because
 * the Issue IS the alert — failing the workflow on top adds noise without
 * extra signal. Batch 5.1 from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.git.jobs.audit-commit-subject
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

function parsePatterns(raw) {
	return raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.map((line) => {
			try {
				return new RegExp(line);
			} catch (err) {
				console.log(`::warning::Skipping invalid regex "${line}": ${err.message}`);
				return null;
			}
		})
		.filter(Boolean);
}

try {
	const sha = getInput("commit_sha", { required: true });
	const patternsRaw = getInput("allowed_patterns", { required: true });
	const labelsRaw = getInput("issue_labels") || "";
	const assignee = getInput("issue_assignee") || "";
	const token = getInput("github_token", { required: true });

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: "${repository}"`);

	const patterns = parsePatterns(patternsRaw);
	if (patterns.length === 0) {
		throw new Error("No valid allowed_patterns provided");
	}

	// Fetch commit + parse subject (first line of commit message)
	const commit = await api("GET", `/commits/${sha}`, null, { token, owner, repo });
	const fullMessage = commit?.commit?.message || "";
	const subject = fullMessage.split(/\r?\n/)[0] || "";
	const shortSha = sha.slice(0, 7);

	console.log(`🔍 Auditing commit ${shortSha} on ${owner}/${repo}`);
	console.log(`📝 Subject: ${subject}`);

	const matched = patterns.find((p) => p.test(subject));
	if (matched) {
		console.log(`✅ Matches pattern: ${matched.source}`);
		appendSummary(`✅ Commit \`${shortSha}\` subject conforms to expected patterns.`);
		process.exit(0);
	}

	console.log(`⚠️ No pattern matched. Auto-filing issue (deduped by SHA).`);

	// Dedup: search for an existing open issue mentioning this short SHA.
	// Search API is eventually-consistent; a duplicate within ~30s is acceptable.
	const searchQuery = encodeURIComponent(`is:open is:issue repo:${owner}/${repo} label:bot:audit "${shortSha}"`);
	const search = await api("GET", `/search/issues?q=${searchQuery}`, null, { token, owner: null, repo: null });
	const existingCount = search?.total_count || 0;
	if (existingCount > 0) {
		console.log(`📋 Existing audit issue found for ${shortSha} — skipping (no duplicate).`);
		appendSummary(`⚠️ Commit \`${shortSha}\` did not match patterns; existing audit issue already filed (no duplicate created).`);
		process.exit(0);
	}

	const labels = labelsRaw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const expectedList = patterns.map((p) => `- \`${p.source}\``).join("\n");
	const commitUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${owner}/${repo}/commit/${sha}`;
	const body = `🤖 **Automated audit**: a commit landed on the default branch whose subject does not match any expected pattern.\n\n` +
		`**Commit:** [\`${shortSha}\`](${commitUrl})\n` +
		`**Subject:** \`${subject}\`\n` +
		`**Author:** ${commit?.commit?.author?.name || "(unknown)"} <${commit?.commit?.author?.email || ""}>\n\n` +
		`### Expected one of:\n\n${expectedList}\n\n` +
		`### What to do\n\n` +
		`- If this commit is **intentional** (manual maintenance, emergency hotfix, etc.), close this issue. To suppress future audits of similar commits, extend \`allowed_patterns\` in the workflow.\n` +
		`- If this commit reflects a **regression in the release workflow** or a **branch-protection bypass**, investigate and fix the underlying tooling.\n\n` +
		`<sub>Filed by [audit-commit-subject](https://github.com/${owner}/${repo}/blob/master/.github/workflows/master-commit-audit.yml). Dedup keyed on the SHA above; re-runs on the same commit will not file duplicate issues.</sub>`;

	const issue = await api(
		"POST",
		`/issues`,
		{
			title: `audit: non-conforming commit subject on ${process.env.GITHUB_REF_NAME || "default branch"} (${shortSha})`,
			body,
			labels,
			assignees: assignee ? [assignee] : []
		},
		{ token, owner, repo }
	);

	console.log(`📋 Audit issue filed: #${issue?.number} ${issue?.html_url}`);
	appendSummary(`📋 **Audit issue filed:** [#${issue?.number}](${issue?.html_url}) for commit \`${shortSha}\``);
	// Exit 0 — issue is the alert.
	process.exit(0);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
