/**
 * @fileoverview On `pull_request: closed && merged == true`, decide
 * whether to delete the just-merged head branch immediately or keep
 * it under a retention rule (in which case older matching branches
 * may be pruned). Batch 1.3.
 * @module @cldmv/.github.git.jobs.branch-retention
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";

/** fnmatch-style glob (`*` matches non-/, `**` matches any). */
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
		else if (".\\+()|^$".includes(c)) re += "\\" + c;
		else re += c;
		i++;
	}
	return new RegExp(re + "$").test(name);
}

/** Check whether a ref exists. */
async function refExists({ token, owner, repo, ref }) {
	try {
		await api("GET", `/git/refs/heads/${encodeURIComponent(ref)}`, null, { token, owner, repo });
		return true;
	} catch (err) {
		if (err.message.includes("404")) return false;
		throw err;
	}
}

/** Delete a ref via REST. Treats 404/422 as already-deleted. */
async function deleteBranch({ token, owner, repo, ref }) {
	try {
		await api("DELETE", `/git/refs/heads/${encodeURIComponent(ref)}`, null, { token, owner, repo });
		return true;
	} catch (err) {
		if (err.message.includes("404") || err.message.includes("422")) return false;
		throw err;
	}
}

/** Enumerate closed-merged PRs whose head matches `pattern`; returns [{ref, merged_at}, ...] (most recent first). */
async function findHistoricalBranches({ token, owner, repo, pattern, maxPages = 5 }) {
	const results = [];
	let page = 1;
	while (page <= maxPages) {
		const batch = await api("GET", `/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`, null, { token, owner, repo });
		if (!Array.isArray(batch) || batch.length === 0) break;
		for (const pr of batch) {
			if (!pr.merged_at) continue;
			const ref = pr.head?.ref;
			if (!ref) continue;
			if (!globMatch(ref, pattern)) continue;
			results.push({ ref, merged_at: pr.merged_at });
		}
		if (batch.length < 100) break;
		page++;
	}
	// Dedupe (same branch can have multiple closed-merged PRs over its lifetime — though rare for release/*)
	const seen = new Set();
	const unique = [];
	for (const r of results) {
		if (!seen.has(r.ref)) {
			seen.add(r.ref);
			unique.push(r);
		}
	}
	// Sort by merged_at descending
	unique.sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
	return unique;
}

try {
	const rulesRaw = getInput("retention_rules") || "[]";
	const exemptRaw = getInput("exempt_patterns") || "[]";
	const token = getInput("github_token", { required: true });

	const rules = JSON.parse(rulesRaw);
	const exemptPatterns = JSON.parse(exemptRaw);

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");

	const eventPath = process.env.GITHUB_EVENT_PATH;
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
	const pr = event.pull_request;
	if (!pr || !pr.merged) {
		console.log("ℹ️ Not a merged PR; nothing to do.");
		process.exit(0);
	}

	const branch = pr.head?.ref;
	if (!branch) {
		console.log("ℹ️ PR has no head ref; skipping.");
		process.exit(0);
	}
	console.log(`🌿 Just-merged branch: ${branch}`);

	// Exempt check
	for (const p of exemptPatterns) {
		if (globMatch(branch, p)) {
			console.log(`⏭️ Exempt (matches "${p}") — leaving alone.`);
			appendSummary(`⏭️ Branch \`${branch}\` is exempt (\`${p}\`); not deleted.`);
			process.exit(0);
		}
	}

	// Retention rule match
	const matchingRule = rules.find((rule) => globMatch(branch, rule.pattern));
	if (!matchingRule) {
		console.log(`✂️ No retention rule matches; deleting ${branch}.`);
		const deleted = await deleteBranch({ token, owner, repo, ref: branch });
		if (deleted) appendSummary(`✂️ Deleted \`${branch}\` (no retention rule matched).`);
		else appendSummary(`ℹ️ \`${branch}\` already deleted (404).`);
		process.exit(0);
	}

	console.log(`🔒 Keeping ${branch} (matches retention rule "${matchingRule.pattern}", keep_last=${matchingRule.keep_last})`);

	// Enumerate historical branches matching same pattern
	const history = await findHistoricalBranches({ token, owner, repo, pattern: matchingRule.pattern });
	console.log(`📜 Found ${history.length} historical merged branch(es) matching ${matchingRule.pattern}`);

	// Filter to those that still exist
	const stillExisting = [];
	for (const h of history) {
		if (await refExists({ token, owner, repo, ref: h.ref })) {
			stillExisting.push(h);
		}
	}
	console.log(`📦 ${stillExisting.length} are still present as refs`);

	const keepCount = Number(matchingRule.keep_last || 5);
	const toKeep = stillExisting.slice(0, keepCount);
	const toDelete = stillExisting.slice(keepCount);

	const summaryLines = [`🔒 Kept \`${branch}\` (retention rule \`${matchingRule.pattern}\`, keep_last=${keepCount})`];
	if (toDelete.length === 0) {
		console.log("✅ Nothing to prune.");
		summaryLines.push(`✅ Nothing older to prune.`);
	} else {
		for (const old of toDelete) {
			console.log(`✂️ Pruning ${old.ref} (merged ${old.merged_at})`);
			const deleted = await deleteBranch({ token, owner, repo, ref: old.ref });
			if (deleted) summaryLines.push(`  - ✂️ Deleted \`${old.ref}\` (merged ${old.merged_at})`);
		}
	}
	for (const l of summaryLines) appendSummary(l);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
