/**
 * @fileoverview Decide whether a triggering change is entirely covered by a
 * caller-supplied `paths_ignore` glob list. Emits `docs_only=true` if every
 * file in the diff matches at least one ignore glob; otherwise `docs_only=false`.
 *
 * Why this exists: putting `paths-ignore:` at the workflow trigger level skips
 * the workflow entirely when only ignored files change, which means the
 * Required PR Check status never posts and branch protection blocks the PR.
 * Moving the decision inside the workflow lets us short-circuit heavy jobs
 * while still posting a green Required PR Check on docs-only PRs.
 *
 * Event handling:
 *   - pull_request / pull_request_target → GET /pulls/{n}/files (paginated)
 *   - push                               → GET /compare/{before}...{after}
 *   - workflow_dispatch / schedule       → no diff context; output is empty
 *     (callers should treat empty as "not docs_only" — i.e. run normally)
 *
 * Fallback: whenever the diff can't be trusted, the gate emits
 * `docs_only=false` plus a `::notice::` naming the reason, so the full CI runs.
 * It never fails the run because of the comparison. That covers:
 *   - a push whose `before` is missing or the zero SHA (new branch / new ref);
 *   - a compare API failure — `404 No common ancestor` when the pushed ref's
 *     history was rewritten (e.g. a new root commit force-pushed over the old
 *     tip), `404 Not Found` when `before` no longer exists, or any other error;
 *   - a compare whose `status` is not `ahead`/`identical` (`diverged` or
 *     `behind`), i.e. `before` is not an ancestor of `after` after a
 *     force-push. A three-dot diff there would describe the wrong change set
 *     (a force-push back to an older commit diffs as empty → docs_only=true).
 *   - a failure listing a pull request's files.
 *
 * Glob semantics mirror GitHub's `paths-ignore`: `*` matches non-slash, `**`
 * matches any (including slashes). Patterns are anchored at the path root.
 *
 * @module @cldmv/.github.common.steps.paths-gate
 */

import { getInput, getEventPayload, setOutputs } from "../../../common/common/core.mjs";
import { api, paginate, parseRepo } from "../../../github/api/_api/core.mjs";

/**
 * Convert a paths-ignore glob to an anchored RegExp.
 * `**` matches any (including `/`), `*` matches non-`/`, `?` matches a single
 * non-`/`. Other regex metacharacters are escaped. Mirrors the matcher used
 * in branch-retention so behavior is consistent across actions.
 *
 * @param {string} name - Filename to test (forward-slash separated).
 * @param {string} pattern - Glob pattern.
 * @returns {boolean}
 */
function globMatch(name, pattern) {
	let re = "^";
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*" && pattern[i + 1] === "*") {
			re += ".*";
			i += 2;
			if (pattern[i] === "/") i++;
			continue;
		}
		if (c === "*") re += "[^/]*";
		else if (c === "?") re += "[^/]";
		else if (".\\+()|^$[]{}".includes(c)) re += "\\" + c;
		else re += c;
		i++;
	}
	return new RegExp(re + "$").test(name);
}

/**
 * Collect changed-file paths for the current event from the GitHub REST API.
 *
 * @param {object} args
 * @param {string} args.token
 * @param {string} args.owner
 * @param {string} args.repo
 * @returns {Promise<{files: string[] | null, reason: string, fallback?: boolean}>}
 *          `files` is `null` when the event has no diff context. `fallback` is
 *          true when a diff was expected but can't be trusted — the caller
 *          must then run the full CI (`docs_only=false`).
 */
async function collectChangedFiles({ token, owner, repo }) {
	const eventName = process.env.GITHUB_EVENT_NAME || "";
	const event = getEventPayload();

	if (eventName === "pull_request" || eventName === "pull_request_target") {
		const prNumber = event.pull_request?.number ?? event.number;
		if (!prNumber) return { files: null, reason: "pull_request event without PR number" };
		try {
			const { items } = await paginate(`/pulls/${prNumber}/files`, { token, owner, repo });
			return { files: items.map((f) => f.filename), reason: `PR #${prNumber}` };
		} catch (error) {
			return { files: null, fallback: true, reason: `listing PR #${prNumber} files failed (${error.message})` };
		}
	}

	if (eventName === "push") {
		const before = event.before || "";
		const after = event.after || process.env.GITHUB_SHA || "";
		if (!before || /^0+$/.test(before)) {
			return {
				files: null,
				fallback: true,
				reason: `push has no usable \`before\` SHA (${before ? "zero SHA — new branch or ref" : "missing"})`
			};
		}
		let compare;
		try {
			compare = await api("GET", `/compare/${before}...${after}`, null, { token, owner, repo });
		} catch (error) {
			const noAncestor = /no common ancestor/i.test(error.message);
			const why = noAncestor
				? "no common ancestor — the pushed ref's history was rewritten"
				: / -> 404:/.test(error.message)
					? "`before` not found — likely removed by a force-push"
					: "compare API error";
			return { files: null, fallback: true, reason: `compare ${before}...${after} failed: ${why} (${error.message})` };
		}
		const status = compare?.status || "";
		if (status && status !== "ahead" && status !== "identical") {
			return {
				files: null,
				fallback: true,
				reason: `compare ${before}...${after} status=${status} — \`before\` is not an ancestor of \`after\` (force-push)`
			};
		}
		return { files: (compare?.files || []).map((f) => f.filename), reason: `compare ${before}...${after}` };
	}

	return { files: null, reason: `event=${eventName} has no diff context` };
}

try {
	const patternsRaw = getInput("paths_ignore");
	const patterns = patternsRaw
		.split("\n")
		.map((s) => s.trim())
		.filter((s) => s && !s.startsWith("#"));

	if (patterns.length === 0) {
		console.log("ℹ️ paths_ignore is empty — opting out (docs_only=false).");
		setOutputs({ docs_only: "false" });
		process.exit(0);
	}

	const token = getInput("github-token", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	console.log("📑 Patterns:");
	for (const p of patterns) console.log(`  ${p}`);

	const { files, reason, fallback } = await collectChangedFiles({ token, owner, repo });

	if (fallback) {
		// Workflow commands are single-line; `%` must be escaped as `%25`.
		const message = reason.replace(/%/g, "%25").replace(/\s*[\r\n]+\s*/g, " ");
		console.log(`::notice title=Paths Gate::Running full CI (docs_only=false): ${message}`);
		setOutputs({ docs_only: "false" });
	} else if (files === null) {
		console.log(`ℹ️ No diff context (${reason}) — emitting empty docs_only.`);
		setOutputs({ docs_only: "" });
	} else if (files.length === 0) {
		console.log("ℹ️ Empty diff — treating as docs_only.");
		setOutputs({ docs_only: "true" });
	} else {
		console.log(`📂 Changed files (${files.length}, source: ${reason}):`);
		let tracked = 0;
		for (const f of files) {
			const ignored = patterns.some((p) => globMatch(f, p));
			if (!ignored) tracked++;
			console.log(`  ${ignored ? "✓ ignored" : "✗ tracked"}  ${f}`);
		}
		const docsOnly = tracked === 0 ? "true" : "false";
		console.log(`📌 docs_only=${docsOnly} (${tracked} tracked / ${files.length} total)`);
		setOutputs({ docs_only: docsOnly });
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
