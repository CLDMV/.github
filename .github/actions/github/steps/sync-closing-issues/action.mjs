/**
 * @fileoverview Sync closing-issue references on a release PR.
 *
 * What it does (additive, idempotent):
 *   1. List every commit in `base..head` via the compare REST endpoint.
 *   2. Regex out `(fix(?:es|ed)?|close[sd]?|resolve[sd]?) #N` from each
 *      commit's full message (subject + body).
 *   3. Find every merged source PR referenced in the range (PR refs of the
 *      form `(#N)` in commit subjects).
 *   4. For each such merged PR, GraphQL-query its `closingIssuesReferences`
 *      — this catches issues a maintainer linked manually via the
 *      Development sidebar without ever writing `Fixes #N` in the body.
 *   5. Union the two sets, resolve each issue number to its node ID via
 *      one batched GraphQL query, query the target PR's existing closing
 *      references, and call `addClosingIssueReference` for any in the
 *      target set that aren't already linked.
 *
 * Deliberately ADDITIVE only. Never removes an existing reference: if a
 * maintainer linked something manually, this action will not silently
 * unlink it on the next refresh.
 *
 * @module @cldmv/.github.github.steps.sync-closing-issues
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

const CLOSE_KW_RE = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)\b/gi;
const PR_REF_RE = /\(#(\d+)\)/g;

/** Minimal GraphQL helper (REST has no equivalent for closing-issue mutations). */
async function graphql(token, query, variables) {
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({ query, variables })
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GraphQL ${res.status}: ${text}`);
	}
	const result = await res.json();
	if (result.errors?.length) {
		throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
	}
	return result.data;
}

/**
 * Pull every issue number off a multi-line text via the close-keyword regex.
 * Exported for testability.
 * @public
 */
export function extractCloseKeywords(text) {
	const found = new Set();
	if (typeof text !== "string" || !text) return found;
	let m;
	const re = new RegExp(CLOSE_KW_RE.source, CLOSE_KW_RE.flags);
	while ((m = re.exec(text)) !== null) found.add(Number(m[1]));
	return found;
}

/**
 * Extract every `(#N)` PR reference from a commit subject. Conservative —
 * only counts parenthesized refs that GitHub itself appends on squash/merge,
 * not bare `#N` inline mentions that could refer to anything.
 * @public
 */
export function extractMergedPRRefs(subject) {
	const found = new Set();
	if (typeof subject !== "string" || !subject) return found;
	let m;
	const re = new RegExp(PR_REF_RE.source, PR_REF_RE.flags);
	while ((m = re.exec(subject)) !== null) found.add(Number(m[1]));
	return found;
}

function parseRange(range) {
	if (typeof range !== "string") throw new Error(`Invalid commit-range: ${range}`);
	const m = range.match(/^(.+?)\.{2,3}(.+)$/);
	if (!m) throw new Error(`Invalid commit-range "${range}" — expected base..head form`);
	return { base: m[1], head: m[2] };
}

async function listRangeCommits(owner, repo, base, head, token) {
	const all = [];
	let page = 1;
	while (true) {
		const data = await api("GET", `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}?per_page=250&page=${page}`, null, { token, owner, repo });
		const commits = data?.commits || [];
		all.push(...commits);
		const total = data?.total_commits ?? all.length;
		if (commits.length === 0 || all.length >= total) break;
		page++;
		if (page > 20) break;
	}
	return all;
}

async function fetchPRClosingIssues(owner, repo, prNumber, token) {
	const q = `
		query($owner: String!, $repo: String!, $n: Int!) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $n) {
					closingIssuesReferences(first: 100) {
						nodes { id number }
					}
				}
			}
		}
	`;
	const data = await graphql(token, q, { owner, repo, n: prNumber });
	return data?.repository?.pullRequest?.closingIssuesReferences?.nodes || [];
}

async function fetchTargetPR(owner, repo, prNumber, token) {
	const q = `
		query($owner: String!, $repo: String!, $n: Int!) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $n) {
					id
					closingIssuesReferences(first: 100) {
						nodes { id number }
					}
				}
			}
		}
	`;
	const data = await graphql(token, q, { owner, repo, n: prNumber });
	const pr = data?.repository?.pullRequest;
	if (!pr) throw new Error(`Target PR #${prNumber} not found via GraphQL`);
	return pr;
}

async function batchResolveIssueIds(owner, repo, issueNumbers, token) {
	if (issueNumbers.length === 0) return new Map();
	// Build a single batched query with aliased fields per issue number.
	// Limit per batch — GitHub caps query node counts; chunk to 50 at a time.
	const result = new Map();
	for (let i = 0; i < issueNumbers.length; i += 50) {
		const slice = issueNumbers.slice(i, i + 50);
		const fields = slice.map((n, idx) => `i${idx}: issueOrPullRequest(number: ${n}) { __typename ... on Issue { id number } ... on PullRequest { id number } }`).join("\n");
		const q = `
			query($owner: String!, $repo: String!) {
				repository(owner: $owner, name: $repo) {
					${fields}
				}
			}
		`;
		const data = await graphql(token, q, { owner, repo });
		const repoNode = data?.repository || {};
		for (let idx = 0; idx < slice.length; idx++) {
			const node = repoNode[`i${idx}`];
			if (!node) continue;
			// Only link real Issues (not PRs — the mutation rejects PR-as-issue).
			if (node.__typename === "Issue" && node.id) {
				result.set(slice[idx], node.id);
			}
		}
	}
	return result;
}

async function addClosingReference(prId, issueId, token) {
	const m = `
		mutation($prId: ID!, $issueId: ID!) {
			addClosingIssueReference(input: { pullRequestId: $prId, issueId: $issueId }) {
				pullRequest { id }
			}
		}
	`;
	await graphql(token, m, { prId, issueId });
}

async function main() {
	const token = getInput("github-token", { required: true });
	const prNumber = Number(getInput("pr-number", { required: true }));
	const range = getInput("commit-range", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const { base, head } = parseRange(range);
	console.log(`🔍 Syncing closing-issue references on PR #${prNumber} for range ${base}...${head}`);

	const commits = await listRangeCommits(owner, repo, base, head, token);
	console.log(`📋 Walked ${commits.length} commit(s) in the range.`);

	const targetIssues = new Set();
	const mergedPRs = new Set();
	for (const c of commits) {
		const msg = c?.commit?.message || "";
		const firstLine = msg.split("\n", 1)[0] || "";
		for (const n of extractCloseKeywords(msg)) targetIssues.add(n);
		for (const n of extractMergedPRRefs(firstLine)) {
			if (n !== prNumber) mergedPRs.add(n);
		}
	}
	console.log(`🔎 Keyword sweep: ${targetIssues.size} issue ref(s) from commit messages.`);
	console.log(`🔗 Merged source PRs in range: ${mergedPRs.size}.`);

	// Pull each merged PR's own linked-issue set — catches UI-only links.
	for (const sourcePR of mergedPRs) {
		try {
			const nodes = await fetchPRClosingIssues(owner, repo, sourcePR, token);
			for (const node of nodes) if (typeof node?.number === "number") targetIssues.add(node.number);
		} catch (err) {
			console.log(`⚠️ Could not fetch closing references for source PR #${sourcePR}: ${err.message}`);
		}
	}
	console.log(`🎯 Total candidate issues to link: ${targetIssues.size}`);

	const targetPR = await fetchTargetPR(owner, repo, prNumber, token);
	const existingNumbers = new Set((targetPR.closingIssuesReferences?.nodes || []).map((n) => n.number));
	console.log(`📌 PR #${prNumber} already has ${existingNumbers.size} closing reference(s).`);

	const toLink = [...targetIssues].filter((n) => !existingNumbers.has(n)).sort((a, b) => a - b);
	if (toLink.length === 0) {
		console.log("✅ Nothing to add — release PR is already in sync.");
		setOutput("added", "");
		setOutput("total", String(existingNumbers.size));
		return;
	}

	const issueIds = await batchResolveIssueIds(owner, repo, toLink, token);
	const added = [];
	for (const n of toLink) {
		const issueId = issueIds.get(n);
		if (!issueId) {
			console.log(`⚠️ #${n} not resolvable as an Issue (probably a PR or deleted); skipping.`);
			continue;
		}
		try {
			await addClosingReference(targetPR.id, issueId, token);
			added.push(n);
			console.log(`🔗 Linked #${n} as a closing reference.`);
		} catch (err) {
			console.log(`⚠️ Could not link #${n}: ${err.message}`);
		}
	}

	console.log(`✅ Added ${added.length} closing reference(s): ${added.map((n) => `#${n}`).join(", ") || "<none>"}.`);
	setOutput("added", added.join(","));
	setOutput("total", String(existingNumbers.size + added.length));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(`::error::${err.message}`);
		process.exit(1);
	});
}
