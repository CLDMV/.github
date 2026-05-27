/**
 * @fileoverview Update an existing release PR's title and body with the latest
 * changelog (with a fallback body when no changelog was generated). Node
 * entrypoint for the update-pr-changelog action.
 *
 * Preserves "sticky" HTML-marker-fenced blocks that other actions inject
 * into the PR body — without preservation, every release-PR refresh would
 * wipe (for example) the coverage badge block from
 * coverage/steps/update-pr-coverage on its way to rewriting the body.
 *
 * Marker convention (open-ended — no central registry):
 *
 *   <!-- <task-id>-start -->
 *   ...content owned by the task...
 *   <!-- <task-id>-end -->
 *
 *   - `<task-id>` is `[a-z][a-z0-9-]*` (lowercase + digits + hyphens,
 *     starts with a letter).
 *   - `<task-id>` must be unique per CI task — pick something specific
 *     enough that it won't collide with another action's namespace.
 *     Examples in flight: `coverage` (.github/actions/coverage/steps/
 *     update-pr-coverage). Future examples might be `bundle-size`,
 *     `perf-regression`, etc.
 *   - Any block matching the convention is preserved automatically by
 *     this action — no list to update here when a new CI task lands.
 *
 * @module @cldmv/.github.github.steps.update-pr-changelog
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput } from "../../../common/common/core.mjs";

const FALLBACK_BODY = [
	"## 🚀 What's Changed",
	"",
	"_Changelog generation in progress. The PR has been updated with the latest commits._",
	"",
	"Please check the commit history for details of the changes included in this release.",
	""
].join("\n");

/**
 * Matches `<!-- <task-id>-start -->...<!-- <task-id>-end -->` block pairs.
 * The backreference on \1 ensures start + end ids match — a stray
 * `<!-- foo-start -->` without a matching `<!-- foo-end -->` doesn't
 * accidentally devour content meant for another block.
 *
 * `[\s\S]*?` (non-greedy across newlines) so two adjacent blocks with
 * different ids don't merge into a single match.
 */
const STICKY_BLOCK_RE = /<!-- ([a-z][a-z0-9-]*)-start -->[\s\S]*?<!-- \1-end -->/g;

/**
 * Extract every sticky block from `body`, in document order.
 *
 * @param {string} body - The current PR body to scan.
 * @returns {string[]} Block text (start marker → end marker inclusive).
 */
function extractStickyBlocks(body) {
	if (!body) return [];
	const blocks = [];
	for (const m of body.matchAll(STICKY_BLOCK_RE)) {
		blocks.push(m[0]);
		console.log(`📌 Preserving sticky block: ${m[1]}`);
	}
	return blocks;
}

try {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const newVersion = getInput("new-version", { required: true });
	const titleSuffix = (getInput("title-suffix") || "").trim();
	const changelog = getInput("changelog-content");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	console.log(`📝 Updating PR #${prNumber} title and description...`);

	const changelogBody = changelog.trim() ? changelog : FALLBACK_BODY;
	if (!changelog.trim()) console.log("⚠️ No changelog generated, using fallback message");

	// Read the current PR body so we can re-attach any sticky blocks owned
	// by other actions. Cheap GET; only fires when the workflow already
	// decided to refresh the PR.
	let currentBody = "";
	try {
		const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
		currentBody = pr?.body || "";
	} catch (err) {
		console.log(`⚠️ Could not GET PR #${prNumber} body to preserve sticky blocks: ${err.message}`);
	}
	const stickyBlocks = extractStickyBlocks(currentBody);

	const composedBody = stickyBlocks.length ? `${changelogBody}\n\n---\n\n${stickyBlocks.join("\n\n")}` : changelogBody;

	const title = titleSuffix ? `release: v${newVersion} - ${titleSuffix}` : `release: v${newVersion}`;
	console.log(`📝 Updating PR title to: ${title}`);
	await api("PATCH", `/pulls/${prNumber}`, { title, body: composedBody }, { token, owner, repo });

	console.log(`✅ PR #${prNumber} has been updated with title '${title}' and latest changelog`);
	if (stickyBlocks.length) console.log(`✅ Preserved ${stickyBlocks.length} sticky block(s) in the PR body`);
	console.log("ℹ️ Skipped full release workflow since PR already exists");
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
