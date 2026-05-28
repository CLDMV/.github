/**
 * @fileoverview Normalize a contributor PR's title to Conventional Commits
 * format, derived from the highest-priority commit in the PR. Implements
 * §6.4 of the v4 design (docs/conventions/release-flow-v4.md).
 *
 * Pure logic functions are exported for test.mjs. The side-effecting main
 * block (gated on import.meta.url === argv[1]) does the API calls.
 *
 * @module @cldmv/.github.github.steps.normalize-pr-title
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs, getBooleanInput } from "../../../common/common/core.mjs";
import {
	TYPE_PRIORITY,
	parseCommit,
	computeHighest
} from "../../../git/steps/compute-highest-commit-type/action.mjs";

/**
 * Sentinel phrase used to dedup the "title was normalized" comment. Must be
 * stable across runs because we scan past comments for it; changing the
 * phrase resets the dedup window.
 * @public
 */
export const COMMENT_SENTINEL = "_Auto-normalized PR title:_";

/**
 * Bot logins whose PRs we DO want to normalize. The default Bot-skip rule in
 * `shouldSkip` exists to leave external bots (dependabot, github-actions,
 * etc.) alone, but cldmv-bot opens our own auto-PRs via local-feature-pr.yml
 * and those titles need to follow the commit set as more commits land.
 * @public
 */
export const NORMALIZE_BOT_ALLOWLIST = new Set(["cldmv-bot[bot]"]);

const CONVENTIONAL_TITLE_RE = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/;

/**
 * Parse a PR title and extract its conventional parts. Returns null when the
 * title doesn't conform.
 *
 * @public
 * @param {string} title
 * @returns {{ type: string, scope: string, breakingMark: boolean, summary: string } | null}
 */
export function extractTitleParts(title) {
	if (typeof title !== "string") return null;
	const m = title.match(CONVENTIONAL_TITLE_RE);
	if (!m) return null;
	return {
		type: m[1].toLowerCase(),
		scope: m[2] || "",
		breakingMark: !!m[3],
		summary: m[4]
	};
}

/**
 * Decide whether to skip normalization based on PR context, before any API
 * traffic. The four skip conditions from §6.4 of the design doc are:
 *   1. PR author is a Bot (github-actions, dependabot, etc.) — EXCEPT logins
 *      in NORMALIZE_BOT_ALLOWLIST (cldmv-bot opens our own feature PRs and
 *      its titles must follow the commit set).
 *   2. Release PR — base = master AND head ∈ { next, hotfix }
 *   3. Title starts with "release:" — escape-hatch override
 *   4. (Not handled here; "title already conforms" is checked later)
 *
 * @public
 * @param {object} ctx
 * @param {string} [ctx.userType] - PR author `user.type` ("User"|"Bot")
 * @param {string} [ctx.userLogin] - PR author `user.login` (e.g., "cldmv-bot[bot]")
 * @param {string} [ctx.baseRef] - PR base branch
 * @param {string} [ctx.headRef] - PR head branch
 * @param {string} [ctx.title] - Current PR title
 * @returns {{ skip: boolean, reason: string }}
 */
export function shouldSkip({ userType, userLogin, baseRef, headRef, title }) {
	if (userType === "Bot" && !NORMALIZE_BOT_ALLOWLIST.has(userLogin)) {
		return { skip: true, reason: "PR author is a Bot" };
	}
	if (baseRef === "master" && (headRef === "next" || headRef === "hotfixes")) {
		return { skip: true, reason: "Release PR (next/hotfixes → master) — owned by the release flow" };
	}
	if (typeof title === "string" && /^release:\s/i.test(title)) {
		return { skip: true, reason: "Title starts with 'release:' — escape-hatch override" };
	}
	return { skip: false, reason: "" };
}

/**
 * Check whether a current title is already acceptable given the required
 * type/breaking from the PR's commits. The title is acceptable when:
 *   - It parses as a conventional title, AND
 *   - Its type's priority is at least as high as the required type
 *     (lower index in TYPE_PRIORITY = higher priority), AND
 *   - If breaking is required, the title carries the `!` mark.
 *
 * Returns true even when the title's type is *more* important than required
 * (e.g., contributor wrote `feat:` but commits only had `fix:` — we respect
 * the contributor).
 *
 * @public
 * @param {string} title
 * @param {string} requiredType
 * @param {boolean} requiredBreaking
 * @returns {boolean}
 */
export function titleConforms(title, requiredType, requiredBreaking) {
	const parts = extractTitleParts(title);
	if (!parts) return false;
	if (requiredBreaking && !parts.breakingMark) return false;
	if (!requiredType) return true; // No required type means anything conventional passes.
	const currentIdx = TYPE_PRIORITY.indexOf(parts.type);
	const requiredIdx = TYPE_PRIORITY.indexOf(requiredType);
	// Unknown types: only accept exact-type match.
	if (currentIdx === -1 || requiredIdx === -1) {
		return parts.type === requiredType;
	}
	return currentIdx <= requiredIdx;
}

/**
 * Build a new conventional title from a chosen type / breaking / summary /
 * optional scope.
 *
 * @public
 */
export function buildNewTitle({ type, isBreaking, summary, scope }) {
	const scopeStr = scope ? `(${scope})` : "";
	const breakingStr = isBreaking ? "!" : "";
	return `${type}${scopeStr}${breakingStr}: ${summary}`;
}

/**
 * Strip the "<type>(<scope>)?(!)?: " prefix from a conventional subject,
 * leaving just the summary text. Returns the input verbatim when it doesn't
 * look conventional.
 *
 * @public
 */
export function summaryFromSubject(subject) {
	if (typeof subject !== "string") return "";
	const m = subject.match(/^[a-z]+(?:\([^)]*\))?(?:!)?:\s+(.+)$/);
	return m ? m[1] : subject;
}

/**
 * Find the FIRST commit (chronologically) whose parsed type matches
 * `targetType`. Used to pick a representative summary for the new title so
 * the title stays pinned to what the PR was originally about — a follow-up
 * `feat:` commit doesn't bump the title to itself; only escalating to a
 * higher tier (e.g. fix → feat) rewrites it, via `titleConforms`.
 *
 * @public
 */
export function findRepresentativeCommit(commits, targetType) {
	if (!Array.isArray(commits) || !targetType) return null;
	// `commits` comes from the PR commits API, which returns OLDEST-first
	// (chronological order, matching the GitHub "Commits" tab). So plain
	// `find` returns the earliest matching commit — the one we want.
	return commits.find((c) => {
		const p = parseCommit(c?.subject ?? c?.commit?.message ?? "", c?.body ?? "");
		return p && p.type === targetType;
	}) || null;
}

// ---- side-effecting main flow (gated to script entry only) ----------------

async function fetchPR(owner, repo, prNumber, token) {
	return api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
}

async function fetchPRCommits(owner, repo, prNumber, token) {
	const raw = await api("GET", `/pulls/${prNumber}/commits?per_page=100`, null, { token, owner, repo });
	// Normalize to the shape compute-highest-commit-type expects: { subject, body }.
	return (raw || []).map((c) => {
		const msg = c?.commit?.message || "";
		const [subject, ...rest] = msg.split("\n");
		const body = rest.join("\n").trim();
		return { subject, body, sha: c?.sha };
	});
}

async function patchTitle(owner, repo, prNumber, newTitle, token) {
	return api("PATCH", `/pulls/${prNumber}`, { title: newTitle }, { token, owner, repo });
}

async function hasSentinelComment(owner, repo, prNumber, token) {
	const comments = await api("GET", `/issues/${prNumber}/comments?per_page=100`, null, { token, owner, repo });
	return (comments || []).some((c) => typeof c?.body === "string" && c.body.includes(COMMENT_SENTINEL));
}

async function postComment(owner, repo, prNumber, oldTitle, newTitle, highestType, token) {
	const body = `${COMMENT_SENTINEL} rewrote PR title to match the highest-priority commit type (\`${highestType}\`).\n\n- **Before:** \`${oldTitle}\`\n- **After:** \`${newTitle}\`\n\nIf this isn't what you want, edit the title — the normalizer won't re-fire as long as the title stays conventional.`;
	return api("POST", `/issues/${prNumber}/comments`, { body }, { token, owner, repo });
}

async function main() {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const dryRun = getBooleanInput("dry-run", false);
	let baseRef = getInput("base-ref");
	let headRef = getInput("head-ref");
	let userType = getInput("user-type");
	let userLogin = getInput("user-login");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const pr = await fetchPR(owner, repo, prNumber, token);
	const currentTitle = pr?.title || "";
	if (!baseRef) baseRef = pr?.base?.ref || "";
	if (!headRef) headRef = pr?.head?.ref || "";
	if (!userType) userType = pr?.user?.type || "";
	if (!userLogin) userLogin = pr?.user?.login || "";

	const skip = shouldSkip({ userType, userLogin, baseRef, headRef, title: currentTitle });
	if (skip.skip) {
		console.log(`⏭️  Skipped: ${skip.reason}`);
		setOutputs({ rewritten: "false", "new-title": currentTitle, skipped: "true", "skip-reason": skip.reason });
		return;
	}

	const commits = await fetchPRCommits(owner, repo, prNumber, token);
	const { highestType, isBreaking } = computeHighest(commits);

	if (!highestType) {
		const reason = "No commits in PR parse as Conventional Commits";
		console.log(`⏭️  Skipped: ${reason}`);
		setOutputs({ rewritten: "false", "new-title": currentTitle, skipped: "true", "skip-reason": reason });
		return;
	}

	if (titleConforms(currentTitle, highestType, isBreaking)) {
		console.log(`✅ Title already conforms (current type ranks ≥ required type \`${highestType}\`).`);
		setOutputs({ rewritten: "false", "new-title": currentTitle, skipped: "false", "skip-reason": "" });
		return;
	}

	const representative = findRepresentativeCommit(commits, highestType);
	const summary = summaryFromSubject(representative?.subject ?? currentTitle);
	const newTitle = buildNewTitle({ type: highestType, isBreaking, summary, scope: "" });

	console.log(`✏️  Rewriting PR title:`);
	console.log(`   before: ${currentTitle}`);
	console.log(`   after:  ${newTitle}`);

	if (dryRun) {
		console.log("ℹ️  dry-run=true — skipping PATCH + comment.");
		setOutputs({ rewritten: "false", "new-title": newTitle, skipped: "false", "skip-reason": "dry-run" });
		return;
	}

	await patchTitle(owner, repo, prNumber, newTitle, token);

	if (!(await hasSentinelComment(owner, repo, prNumber, token))) {
		await postComment(owner, repo, prNumber, currentTitle, newTitle, highestType, token);
		console.log("💬 Posted explanatory comment (first time).");
	} else {
		console.log("💬 Sentinel comment already present — skipping comment post.");
	}

	setOutputs({ rewritten: "true", "new-title": newTitle, skipped: "false", "skip-reason": "" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
