/**
 * @fileoverview Fail a push or PR that adds a commit whose subject isn't conventional.
 *
 * The release bump (get-commit-range → check-release-commit) reads every
 * commit subject in the release range. A conventional `type(scope)!:` subject
 * is classified by its type. Anything else falls through to a content guess:
 * a subject containing "add" or "new" counts as a feature, one containing
 * "fix" as a fix. So `agent add: …` proposed a minor release for a patch
 * (CLDMV/.github#527). Checking the subjects before the PR merges keeps them
 * out of `next`.
 *
 * Range checked, per event:
 *   - pull_request / pull_request_target → GET /pulls/{n}/commits. Skipped
 *     for release PRs (head `next` / `hotfixes`), whose commits were already
 *     checked on their way in.
 *   - push to a feature branch → GET /compare/{base}...{after}, where {base}
 *     is the branch its PR targets, routed like feature-pr.yml: `hotfix/**` →
 *     hotfixes, the captured prefixes → next. The whole branch is checked.
 *   - push to any other branch (`dev`, `next`, `hotfixes`, `copilot/*`,
 *     `wip/*`, …) → GET /compare/{before}...{after}, only the commits that
 *     push added (CLDMV/.github#557, #560). That catches a direct commit to
 *     `next` (a fix for a review on the release PR) and Copilot's `Initial
 *     plan` commits; a normal PR merge passes because merge commits are
 *     exempt. A new branch is compared against `next`, except a new `dev`,
 *     `next` or `hotfixes`, which is skipped. A push that rewrote history is
 *     skipped (silently on `next` / `hotfixes`, which every release resets).
 *   - pushes to the default branch, `master`, `main`, `badges`, `gh-pages`
 *     and `dependabot/*` aren't checked.
 *   - anything else (workflow_dispatch, schedule) → skipped.
 *
 * Merge commits (two or more parents) are exempt: the v4 flow titles them
 * from the PR, and the bump skips them by parent count.
 *
 * A range the API can't list (compare 404, missing base) is skipped with a
 * `::warning::`, not failed: the master commit audit still catches a bad
 * subject after release, and an infra error shouldn't block every PR.
 *
 * Outputs `ok`: `true` / `false`, or empty when nothing was checked. Exits 1
 * when `ok=false`, so the job fails and the reusable CI's result is a failure.
 *
 * @module @cldmv/.github.common.steps.commit-subjects
 */

import { getInput, getEventPayload, setOutputs, appendSummary } from "../../../common/common/core.mjs";
import { api, paginate, parseRepo } from "../../../github/api/_api/core.mjs";

/**
 * Types the release tooling understands. Matches the list in the issue and
 * get-commit-range's parser (`feature` is its alias for `feat`).
 */
export const CONVENTIONAL_TYPES = [
	"feat",
	"feature",
	"fix",
	"perf",
	"refactor",
	"test",
	"docs",
	"chore",
	"ci",
	"build",
	"style",
	"revert",
	"deps",
	"release"
];

const SUBJECT_RE = new RegExp(`^(?:${CONVENTIONAL_TYPES.join("|")})(?:\\([^()\\s][^()]*\\))?!?: \\S`);

/** Prefixes feature-pr.yml routes into `next`. Keep in step with its case arms and paths-gate. */
const NEXT_PREFIXES = ["feat", "feature", "fix", "docs", "chore", "deps", "refactor", "ci", "perf", "test", "style", "release"];

/**
 * Whether a subject line is conventional: a known lowercase type, an optional
 * non-empty `(scope)`, an optional `!`, then `: ` and text.
 *
 * @param {string} subject - First line of the commit message.
 * @returns {boolean}
 */
export function isConventionalSubject(subject) {
	return SUBJECT_RE.test(String(subject || ""));
}

/**
 * Pick the branch a pushed branch's PR targets, or null when the branch isn't
 * one feature-pr.yml opens a PR for.
 *
 * @param {string} branch - Pushed branch name (without refs/heads/).
 * @returns {string|null}
 */
export function resolvePrBase(branch) {
	if (!branch) return null;
	if (branch.startsWith("hotfix/")) return "hotfixes";
	if (NEXT_PREFIXES.some((p) => branch.startsWith(`${p}/`))) return "next";
	return null;
}

/**
 * Split commits into the ones that fail the check and a count of exempt ones.
 *
 * @param {Array<{sha: string, commit?: {message?: string}, parents?: any[]}>} commits - REST commit objects.
 * @returns {{bad: Array<{sha: string, subject: string}>, checked: number, merges: number}}
 */
export function findBadSubjects(commits) {
	const bad = [];
	let checked = 0;
	let merges = 0;
	for (const c of commits || []) {
		if ((c.parents || []).length >= 2) {
			merges++;
			continue;
		}
		checked++;
		const subject = String(c.commit?.message || "")
			.split("\n")[0]
			.trim();
		if (!isConventionalSubject(subject)) bad.push({ sha: c.sha, subject });
	}
	return { bad, checked, merges };
}

/**
 * Branches whose pushes are never checked: the release branch (only the
 * release commit lands there; master-commit-audit checks it), the bot-only
 * `badges` / `gh-pages`, and Dependabot's own branches.
 *
 * @param {string} branch - Pushed branch name (without refs/heads/).
 * @param {string} defaultBranch - The repository's default branch.
 * @returns {boolean}
 */
export function isUncheckedBranch(branch, defaultBranch = "") {
	if (!branch) return true;
	if (["master", "main", "badges", "gh-pages"].includes(branch)) return true;
	if (defaultBranch && branch === defaultBranch) return true;
	return branch.startsWith("dependabot/");
}

/** Integration branches the release flow force-resets after a release. */
const RESET_BRANCHES = ["next", "hotfixes"];

/**
 * Pick the base a brand-new branch is compared against, or null when a new
 * branch shouldn't be checked (a new `dev`, `next` or `hotfixes` would drag
 * in history that was never meant to be checked).
 *
 * @param {string} branch
 * @returns {string|null}
 */
export function newBranchBase(branch) {
	if (branch === "dev" || RESET_BRANCHES.includes(branch)) return null;
	return "next";
}

/**
 * Compare two refs and turn the result into the commits to check.
 *
 * @returns {Promise<{commits: any[] | null, reason: string, warn?: boolean}>}
 */
async function compareRange({ token, owner, repo, base, head, label }) {
	try {
		const compare = await api("GET", `/compare/${encodeURIComponent(base)}...${head}`, null, { token, owner, repo });
		const commits = compare?.commits || [];
		const total = Number(compare?.total_commits ?? commits.length);
		if (total > commits.length) {
			return {
				commits,
				warn: true,
				reason: `${label} lists ${commits.length} of ${total} commits (the API's cap); only those were checked`
			};
		}
		return { commits, reason: label, status: compare?.status };
	} catch (error) {
		return { commits: null, warn: true, reason: `${label} failed (${error.message})` };
	}
}

/**
 * Commits a push to a non-feature branch added (`dev`, `next`, `hotfixes`,
 * `copilot/*`, `wip/*`, …): compare {before}...{after}. A new branch is
 * compared against `next` instead (see newBranchBase).
 *
 * @returns {Promise<{commits: any[] | null, reason: string, warn?: boolean}>}
 */
async function collectPushRange({ token, owner, repo, event, branch, after }) {
	const before = event.before || "";
	if (!before || /^0+$/.test(before)) {
		const base = newBranchBase(branch);
		if (!base) return { commits: null, reason: `push created ${branch}; no earlier tip to compare against` };
		return compareRange({ token, owner, repo, base, head: after, label: `new branch ${branch}, compare ${base}...${branch}` });
	}
	const range = `${before.slice(0, 7)}...${after.slice(0, 7)}`;
	const result = await compareRange({ token, owner, repo, base: before, head: after, label: `push to ${branch} (${range})` });
	if (result.status === "diverged" || result.status === "behind") {
		// next/hotfixes are force-reset to master after every release, so a
		// rewrite there is routine; anywhere else it's worth a warning.
		const expected = RESET_BRANCHES.includes(branch);
		return { commits: null, warn: !expected, reason: `push to ${branch} rewrote history (compare ${range} is ${result.status})` };
	}
	return result;
}

/**
 * List the commits to check for the current event.
 *
 * @returns {Promise<{commits: any[] | null, reason: string, warn?: boolean}>}
 *          `commits` is null when nothing should be checked.
 */
async function collectCommits({ token, owner, repo }) {
	const eventName = process.env.GITHUB_EVENT_NAME || "";
	const event = getEventPayload();

	if (eventName === "pull_request" || eventName === "pull_request_target") {
		const pr = event.pull_request || {};
		const headRef = pr.head?.ref || "";
		if (headRef === "next" || headRef === "hotfixes") {
			return { commits: null, reason: `release PR (head ${headRef}); its commits were checked on their way in` };
		}
		const number = pr.number ?? event.number;
		if (!number) return { commits: null, reason: "pull_request event without a PR number" };
		try {
			const { items } = await paginate(`/pulls/${number}/commits`, { token, owner, repo });
			return { commits: items, reason: `PR #${number}` };
		} catch (error) {
			return { commits: null, warn: true, reason: `listing PR #${number} commits failed (${error.message})` };
		}
	}

	if (eventName === "push") {
		const ref = event.ref || process.env.GITHUB_REF || "";
		const branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
		const after = event.after || process.env.GITHUB_SHA || "";
		if (isUncheckedBranch(branch, event.repository?.default_branch || "")) {
			return { commits: null, reason: `push to ${branch || ref}, which isn't checked` };
		}
		if (!after || /^0+$/.test(after)) return { commits: null, reason: `push deleted ${branch}` };
		// Feature branches: everything the branch has that its PR base
		// doesn't, so the whole branch is checked before it can merge.
		const base = resolvePrBase(branch);
		if (base) return compareRange({ token, owner, repo, base, head: after, label: `compare ${base}...${branch}` });
		// Everything else (dev, next, hotfixes, copilot/*, wip/*, …): the
		// commits this push added. A PR merge into next passes because its
		// merge commit is exempt and its commits were checked on the branch.
		return collectPushRange({ token, owner, repo, event, branch, after });
	}

	return { commits: null, reason: `event=${eventName} has no commit range` };
}

/**
 * Escape a commit subject for a markdown table cell: backslashes first, then
 * pipes (which would end the cell) and markdown punctuation that would render.
 *
 * @param {string} text
 * @returns {string}
 */
export function tableCell(text) {
	return String(text).replace(/[\\`*_|<>[\]]/g, (c) => `\\${c}`);
}

/** Escape text for a single-line workflow command. */
function cmd(text) {
	return String(text).replace(/%/g, "%25").replace(/\r?\n/g, " ");
}

async function main() {
	const token = getInput("github-token", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const { commits, reason, warn } = await collectCommits({ token, owner, repo });

	if (commits === null) {
		if (warn) console.log(`::warning title=Commit Subjects::Not checked: ${cmd(reason)}`);
		else console.log(`ℹ️ Not checked: ${reason}`);
		setOutputs({ ok: "" });
		return 0;
	}
	if (warn) console.log(`::warning title=Commit Subjects::${cmd(reason)}`);

	const { bad, checked, merges } = findBadSubjects(commits);
	console.log(`📝 ${checked} commit(s) checked, ${merges} merge commit(s) exempt (source: ${reason})`);

	if (bad.length === 0) {
		console.log("✅ Every commit subject is conventional.");
		setOutputs({ ok: "true" });
		return 0;
	}

	const types = CONVENTIONAL_TYPES.join(", ");
	for (const b of bad) {
		console.log(`::error title=Non-conventional commit subject::${b.sha.slice(0, 7)} ${cmd(b.subject)}`);
	}
	console.log(
		`\n${bad.length} commit subject(s) aren't conventional. The release bump reads these subjects, so they would change the version.\n` +
			`Use \`type(scope): summary\` with one of: ${types} (add \`!\` for a breaking change).\n` +
			`Reword them (git rebase -i <base>, then "reword") and force-push the branch.`
	);
	appendSummary(
		[
			"### 📝 Non-conventional commit subjects",
			"",
			"| Commit | Subject |",
			"|---|---|",
			...bad.map((b) => `| \`${b.sha.slice(0, 7)}\` | ${tableCell(b.subject) || "_(empty)_"} |`),
			"",
			`Use \`type(scope): summary\` with one of: ${types}. Reword them and force-push the branch.`,
			""
		].join("\n")
	);
	setOutputs({ ok: "false" });
	return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exitCode = 1;
	}
}
