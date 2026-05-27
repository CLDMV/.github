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
 * @returns {Promise<{files: string[] | null, reason: string}>}
 *          `files` is `null` when the event has no diff context.
 */
async function collectChangedFiles({ token, owner, repo }) {
	const eventName = process.env.GITHUB_EVENT_NAME || "";
	const event = getEventPayload();

	if (eventName === "pull_request" || eventName === "pull_request_target") {
		const prNumber = event.pull_request?.number ?? event.number;
		if (!prNumber) return { files: null, reason: "pull_request event without PR number" };
		const { items } = await paginate(`/pulls/${prNumber}/files`, { token, owner, repo });
		return { files: items.map((f) => f.filename), reason: `PR #${prNumber}` };
	}

	if (eventName === "push") {
		const before = event.before || "";
		const after = event.after || process.env.GITHUB_SHA || "";
		if (!before || /^0+$/.test(before)) {
			return { files: null, reason: "push event with no `before` SHA (new branch)" };
		}
		const compare = await api("GET", `/compare/${before}...${after}`, null, { token, owner, repo });
		return { files: (compare.files || []).map((f) => f.filename), reason: `compare ${before}...${after}` };
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

	const { files, reason } = await collectChangedFiles({ token, owner, repo });

	if (files === null) {
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
