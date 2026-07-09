/**
 * @fileoverview Close issues resolved by PRs bundled into a release, once the
 * release lands on the default branch.
 *
 * Why this exists: in the v4 staging-branch flow, GitHub's own keyword
 * auto-close (`Fixes/Closes/Resolves #N`) never fires. Contributor PRs merge
 * into `next`/`hotfixes`, not the default branch, so a keyword there does
 * nothing; the release PR that finally reaches master squash-merges a
 * changelog, not per-issue keyword text, so nothing fires there either. This
 * action does the closing itself, once the release actually lands.
 *
 * What it does:
 *   1. Resolve the release PR (the `next`/`hotfixes` → master squash-merge)
 *      from the trailing `(#N)` on the release commit's subject.
 *   2. Walk that PR's `base.sha..head.sha` range via the compare REST
 *      endpoint. Each commit in the range is one contributor PR's
 *      merge-commit — pull its trailing `(#N)` (the source PR) and sweep its
 *      full message (subject+body) for `Fixes/Closes/Resolves #N` keywords,
 *      attributed to that same source PR.
 *   3. For each source PR found, also sweep its own description and comments
 *      for BOTH a `<!-- gh-broker:resolves:N,M --> ` marker and the same
 *      keyword forms — catches issues named after the fact (a comment) or in
 *      the PR description rather than the commit message.
 *   4. Close every referenced issue that's still open, commenting with the
 *      release version and the resolving PR.
 *
 * Dual signal, both attributed to the actual source PR: the `gh-broker:
 * resolves:` marker (posted by the issue/PR agent) AND native-looking
 * Fixes/Closes/Resolves keywords (however they got into the PR — commit,
 * description, or comment). There is no GraphQL mutation for a closing
 * reference (`addClosingIssueReference` is not a real field — it never
 * existed on GitHub's schema), so this closes issues directly via the REST
 * issues API instead of trying to link them.
 *
 * Best-effort per issue: one issue's failure is logged and skipped, never
 * aborts the rest.
 *
 * @module @cldmv/.github.github.steps.close-resolved-issues
 */

import { api, paginate, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

const PR_REF_RE = /\(#(\d+)\)/g;
const RESOLVES_MARKER_RE = /<!--\s*gh-broker:resolves:\s*([\d,\s#]+?)\s*-->/gi;
const CLOSE_KW_RE = /\b(?:fix(?:es|ed)?|close[sd]?|resolve[sd]?)\s+#(\d+)\b/gi;

/**
 * Extract every `(#N)` PR reference from a commit subject. Conservative —
 * only counts parenthesized refs that GitHub itself appends on merge/squash,
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

/**
 * The trailing `(#N)` in a subject — the PR ref GitHub appends on
 * merge/squash (`merge_commit_title: PR_TITLE` / `squash_merge_commit_title:
 * PR_TITLE`), as opposed to any earlier inline mention. Mirrors the
 * `grep -oE '#[0-9]+' | tail -1` extraction local-next-reset.yml already uses
 * to find the released lane from a release commit's subject.
 * @public
 */
export function extractTrailingPRRef(subject) {
	const refs = [...extractMergedPRRefs(subject)];
	return refs.length ? refs[refs.length - 1] : null;
}

/**
 * Extract every issue number named by `<!-- gh-broker:resolves:N,M --> `
 * marker comments in a block of text. Numbers inside one marker may be
 * separated by commas, whitespace, and/or a leading `#`; multiple markers
 * (e.g. across different comments) all contribute to the result.
 * @public
 */
export function extractResolvesMarkers(text) {
	const found = new Set();
	if (typeof text !== "string" || !text) return found;
	let m;
	const re = new RegExp(RESOLVES_MARKER_RE.source, RESOLVES_MARKER_RE.flags);
	while ((m = re.exec(text)) !== null) {
		for (const piece of m[1].split(/[,\s#]+/)) {
			if (!piece) continue;
			const n = Number(piece);
			if (Number.isInteger(n) && n > 0) found.add(n);
		}
	}
	return found;
}

/**
 * Pull every issue number off a block of text via the
 * `(fix(es|ed)?|close[sd]?|resolve[sd]?) #N` keyword regex — the same forms
 * GitHub's own native auto-close recognizes.
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

/** Add every number `extract(text)` finds to `map`, keeping the first source PR seen per issue. */
function collectInto(map, extract, text, sourcePR) {
	for (const n of extract(text)) {
		if (!map.has(n)) map.set(n, sourcePR);
	}
}

async function main() {
	const token = getInput("github-token", { required: true });
	const releaseVersion = getInput("release-version", { required: true });
	const sha = getInput("commit-sha") || process.env.GITHUB_SHA;
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	if (!sha) throw new Error("No commit SHA available — pass commit-sha or run this action where GITHUB_SHA is set.");

	console.log(`🔍 Resolving the release PR for ${sha.slice(0, 7)}...`);
	const commit = await api("GET", `/commits/${sha}`, null, { token, owner, repo });
	const subject = (commit?.commit?.message || "").split("\n", 1)[0] || "";
	const releasePR = extractTrailingPRRef(subject);

	if (!releasePR) {
		console.log(`ℹ️ No trailing "(#N)" reference in "${subject}" — nothing to close.`);
		setOutput("closed", "");
		return;
	}
	console.log(`🔗 Release PR: #${releasePR} ("${subject}")`);

	const pr = await api("GET", `/pulls/${releasePR}`, null, { token, owner, repo });
	const commitRange = `${pr.base.sha}..${pr.head.sha}`;
	console.log(`🔍 Walking commit range ${commitRange} for bundled source PRs...`);

	const commits = await listRangeCommits(owner, repo, pr.base.sha, pr.head.sha, token);
	console.log(`📋 Walked ${commits.length} commit(s).`);

	// issue number -> resolving source PR (first signal found wins)
	const issueSources = new Map();
	const sourcePRs = new Set();

	// Pass 1: each merge commit in the range IS one contributor PR. Pull its
	// trailing PR ref AND sweep its full message (subject+body) for
	// Fixes/Closes/Resolves keywords, attributed to that same PR — this is
	// what GitHub's native keyword auto-close would already have done if the
	// commit had landed straight on the default branch.
	for (const c of commits) {
		const fullMessage = c?.commit?.message || "";
		const firstLine = fullMessage.split("\n", 1)[0] || "";
		const prRefs = [...extractMergedPRRefs(firstLine)].filter((n) => n !== releasePR);
		for (const n of prRefs) sourcePRs.add(n);

		const attributedPR = prRefs[prRefs.length - 1];
		if (attributedPR == null) continue;
		collectInto(issueSources, extractCloseKeywords, fullMessage, attributedPR);
	}
	console.log(`🔗 Source PR(s) bundled in this release: ${sourcePRs.size ? [...sourcePRs].sort((a, b) => a - b).map((n) => `#${n}`).join(", ") : "<none>"}`);

	// Pass 2: for each source PR, also sweep its own description and comments
	// for the gh-broker:resolves: marker AND the same keyword forms — catches
	// issues named in a follow-up comment or only in the PR description
	// rather than the commit message itself.
	for (const sourcePR of sourcePRs) {
		try {
			const [sourcePRData, comments] = await Promise.all([
				api("GET", `/pulls/${sourcePR}`, null, { token, owner, repo }),
				paginate(`/issues/${sourcePR}/comments`, { token, owner, repo })
			]);
			const texts = [sourcePRData?.body || "", ...comments.items.map((c) => c?.body || "")];
			for (const text of texts) {
				collectInto(issueSources, extractResolvesMarkers, text, sourcePR);
				collectInto(issueSources, extractCloseKeywords, text, sourcePR);
			}
		} catch (err) {
			console.log(`⚠️ Could not read PR #${sourcePR} (description/comments): ${err.message}`);
		}
	}
	console.log(`🎯 Candidate issue(s) to close: ${issueSources.size}`);

	const closed = [];
	for (const [issueNumber, sourcePR] of [...issueSources.entries()].sort((a, b) => a[0] - b[0])) {
		try {
			const issue = await api("GET", `/issues/${issueNumber}`, null, { token, owner, repo });
			if (issue?.pull_request) {
				console.log(`⏭️ #${issueNumber} is a pull request, not an issue — skipping.`);
				continue;
			}
			if (!issue || issue.state !== "open") {
				console.log(`⏭️ #${issueNumber} already ${issue?.state || "missing"} — skipping.`);
				continue;
			}
			await api("POST", `/issues/${issueNumber}/comments`, { body: `Closed in ${releaseVersion} — resolved by #${sourcePR}.` }, { token, owner, repo });
			await api("PATCH", `/issues/${issueNumber}`, { state: "closed", state_reason: "completed" }, { token, owner, repo });
			closed.push(issueNumber);
			console.log(`✅ Closed #${issueNumber} (resolved by #${sourcePR}).`);
		} catch (err) {
			console.log(`⚠️ Could not close #${issueNumber}: ${err.message}`);
		}
	}

	console.log(`✅ Closed ${closed.length} issue(s): ${closed.map((n) => `#${n}`).join(", ") || "<none>"}.`);
	setOutput("closed", closed.join(","));
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(`::error::${err.message}`);
		process.exit(1);
	});
}
