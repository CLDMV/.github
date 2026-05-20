/**
 * @fileoverview Enumerate open pull requests whose title matches a
 * release-version regex (default: "release: vX.Y.Z"). Emits a stable
 * JSON array of {number, head_ref} for matrix-driven fan-out.
 * @module @cldmv/.github.github.api.list-release-prs
 */

import { getInput, setOutput } from "../../../common/common/core.mjs";
import { api } from "../_api/core.mjs";

try {
	const token = getInput("github-token", { required: true });
	const owner = getInput("owner", { required: true });
	const repo = getInput("repo", { required: true });
	const patternStr = getInput("title-pattern") || "^release: v\\d+\\.\\d+\\.\\d+$";

	let pattern;
	try {
		pattern = new RegExp(patternStr);
	} catch (err) {
		throw new Error(`Invalid title-pattern regex "${patternStr}": ${err.message}`);
	}

	const results = [];
	let page = 1;
	// Cap pages so a misconfigured pattern can't cause an unbounded loop.
	const maxPages = 10;
	while (page <= maxPages) {
		const pulls = await api("GET", `/pulls?state=open&per_page=100&page=${page}`, null, { token, owner, repo });
		if (!Array.isArray(pulls) || pulls.length === 0) break;
		for (const pr of pulls) {
			if (pattern.test(pr.title)) {
				results.push({ number: pr.number, head_ref: pr.head.ref });
			}
		}
		if (pulls.length < 100) break;
		page++;
	}

	console.log(`📋 Found ${results.length} open release PR(s) matching ${patternStr}`);
	for (const pr of results) {
		console.log(`   • PR #${pr.number} on ${pr.head_ref}`);
	}

	setOutput("prs", JSON.stringify(results));
	setOutput("count", String(results.length));
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
