/**
 * @fileoverview Stale-sweep entry. Enumerates open issues and PRs, runs
 * each through the classifier, applies decisions via the actor module.
 * Rate-limit aware (aborts cleanly with summary if remaining gets low).
 * Batch 2.3 from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.github.jobs.stale-sweep.action
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api, paginate } from "../../api/_api/core.mjs";
import { buildConfig, classify, effectiveLastActivity, Action } from "./classifier.mjs";
import { markStale, closeItem, unstale } from "./actor.mjs";

/** Find the timestamp when a specific label was most recently added to an issue. */
async function findLabelAddedAt(owner, repo, token, issueNumber, labelName) {
	try {
		const events = await api("GET", `/issues/${issueNumber}/events?per_page=100`, null, { token, owner, repo });
		if (!Array.isArray(events)) return null;
		// Walk events in reverse-chronological order; first matching `labeled` event wins.
		for (let i = events.length - 1; i >= 0; i--) {
			const e = events[i];
			if (e.event === "labeled" && e.label?.name?.toLowerCase() === labelName.toLowerCase()) {
				return Date.parse(e.created_at);
			}
		}
		return null;
	} catch (err) {
		console.log(`::warning::Could not fetch events for #${issueNumber}: ${err.message}`);
		return null;
	}
}

/** Find the most recent comment timestamp newer than a given ms. */
async function findLatestCommentAfter(owner, repo, token, issueNumber, sinceMs) {
	if (!sinceMs) return null;
	const sinceIso = new Date(sinceMs).toISOString();
	try {
		const comments = await api("GET", `/issues/${issueNumber}/comments?since=${encodeURIComponent(sinceIso)}&per_page=100`, null, { token, owner, repo });
		if (!Array.isArray(comments) || comments.length === 0) return null;
		// Sorted ascending by default; last is most recent.
		const last = comments[comments.length - 1];
		return last?.created_at ? Date.parse(last.created_at) : null;
	} catch {
		return null;
	}
}

try {
	const token = getInput("github_token", { required: true });
	const config = buildConfig(getInput);
	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: "${repository}"`);

	const nowMs = Date.now();
	console.log(`🍂 Stale-sweep starting on ${owner}/${repo} (dry_run=${config.dryRun})`);
	console.log(`📋 Config: issues ${config.daysBeforeIssueStale}d+${config.daysBeforeIssueClose}d; PRs ${config.daysBeforePrStale}d+${config.daysBeforePrClose}d; ops cap ${config.operationsPerRun}`);

	// Enumerate open issues AND PRs (REST returns PRs as issues with pull_request key).
	const { items: openIssues, rateLimitedOut, lastRemaining } = await paginate(
		"/issues?state=open&filter=all",
		{ token, owner, repo, maxPages: 20, perPage: 100, rateLimitFloor: 200 }
	);
	console.log(`📊 Found ${openIssues.length} open issues/PRs (rate-limit remaining=${lastRemaining})`);
	if (rateLimitedOut) {
		appendSummary(`⚠️ Stale-sweep aborted enumeration early due to rate limit. ${openIssues.length} items scanned.`);
	}

	let operationsUsed = 0;
	const stats = { skip: 0, mark: 0, close: 0, unstale: 0 };

	for (const item of openIssues) {
		if (operationsUsed >= config.operationsPerRun) {
			console.log(`⛔ Operations cap (${config.operationsPerRun}) reached; deferring remaining items to next run.`);
			break;
		}

		const isPR = !!item.pull_request;
		const labelName = isPR ? config.stalePrLabel : config.staleIssueLabel;
		const labelNames = (item.labels || []).map((l) => (typeof l === "string" ? l : l.name));
		const isCurrentlyStale = labelNames.some((n) => n.toLowerCase() === labelName.toLowerCase());

		// Find when the stale label was applied (if stale)
		const staleAddedAtMs = isCurrentlyStale ? await findLabelAddedAt(owner, repo, token, item.number, labelName) : null;

		// Effective last-activity = max(updated_at, latest comment created_at).
		// We only need to refine if the item is already stale, to detect un-stale.
		let latestCommentMs = null;
		if (isCurrentlyStale && staleAddedAtMs) {
			latestCommentMs = await findLatestCommentAfter(owner, repo, token, item.number, staleAddedAtMs);
		}
		const lastActivityMs = effectiveLastActivity(item, latestCommentMs ? new Date(latestCommentMs).toISOString() : null);

		const decision = classify({ item, isPR, config, staleAddedAtMs, lastActivityMs, nowMs });

		const prefix = isPR ? "PR" : "issue";
		console.log(`${prefix} #${item.number}: ${decision.action} — ${decision.reason}`);

		switch (decision.action) {
			case Action.SKIP:
				stats.skip++;
				break;
			case Action.MARK_STALE:
				await markStale({
					owner, repo, token, item,
					label: labelName,
					message: isPR ? config.stalePrMessage : config.staleIssueMessage,
					dryRun: config.dryRun
				});
				stats.mark++;
				operationsUsed++;
				break;
			case Action.CLOSE:
				await closeItem({
					owner, repo, token, item,
					message: isPR ? config.closePrMessage : config.closeIssueMessage,
					dryRun: config.dryRun
				});
				stats.close++;
				operationsUsed++;
				break;
			case Action.UNSTALE:
				await unstale({
					owner, repo, token, item,
					label: labelName,
					dryRun: config.dryRun
				});
				stats.unstale++;
				operationsUsed++;
				break;
		}
	}

	const lines = [
		`## 🍂 Stale Sweep Summary`,
		``,
		`- ⏭️ Skipped (active or exempt): **${stats.skip}**`,
		`- 🏷️ Marked stale: **${stats.mark}**`,
		`- 🔒 Closed: **${stats.close}**`,
		`- 🔄 Un-staled (activity resumed): **${stats.unstale}**`,
		`- Operations cap: ${operationsUsed}/${config.operationsPerRun}`,
		config.dryRun ? `- 🧪 DRY RUN — no changes were made` : ``
	].filter(Boolean);
	for (const line of lines) appendSummary(line);

	console.log("");
	console.log(`✅ Done. ${stats.mark} marked, ${stats.close} closed, ${stats.unstale} un-staled, ${stats.skip} skipped.`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
