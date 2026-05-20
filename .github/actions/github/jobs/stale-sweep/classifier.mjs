/**
 * @fileoverview Per-item state machine for the stale sweep. Pure functions —
 * no I/O — so the logic is testable in isolation.
 * @module @cldmv/.github.github.jobs.stale-sweep.classifier
 */

/** Decision values emitted by classify(). */
export const Action = Object.freeze({
	SKIP: "skip", // exempt or already in a stable state
	MARK_STALE: "mark-stale", // not yet stale, but inactive long enough
	CLOSE: "close", // already labeled stale, grace period elapsed
	UNSTALE: "unstale" // already labeled stale, but new activity arrived
});

/** Parse a comma-sep list of label names. */
export function parseLabelList(raw) {
	return (raw || "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

/** Get the latest comment timestamp for an item (or its updated_at as fallback). */
export function effectiveLastActivity(item, latestCommentAt) {
	const updated = item.updated_at ? Date.parse(item.updated_at) : 0;
	const commented = latestCommentAt ? Date.parse(latestCommentAt) : 0;
	return Math.max(updated, commented);
}

/** ms since epoch → days from now (positive when past). */
export function daysSince(msSinceEpoch, nowMs) {
	const diffMs = nowMs - msSinceEpoch;
	return diffMs / (1000 * 60 * 60 * 24);
}

/**
 * Decide what to do with one issue or PR.
 *
 * @param {object} args
 * @param {object} args.item - GitHub issue/PR object (must have labels, assignee, milestone, updated_at).
 * @param {boolean} args.isPR - true for PRs, false for issues.
 * @param {object} args.config - parsed config from inputs.
 * @param {number} args.staleAddedAtMs - timestamp of when stale label was added; null if not stale yet.
 * @param {number} args.lastActivityMs - timestamp of last real activity (max(updated_at, last comment)).
 * @param {number} args.nowMs - current time.
 * @returns {{ action: string, reason: string }}
 */
export function classify({ item, isPR, config, staleAddedAtMs, lastActivityMs, nowMs }) {
	const labels = (item.labels || []).map((l) => (typeof l === "string" ? l : l.name).toLowerCase());
	const exemptLabels = isPR ? config.exemptPrLabels : config.exemptIssueLabels;
	const staleLabel = (isPR ? config.stalePrLabel : config.staleIssueLabel).toLowerCase();
	const daysBeforeStale = isPR ? config.daysBeforePrStale : config.daysBeforeIssueStale;
	const daysBeforeClose = isPR ? config.daysBeforePrClose : config.daysBeforeIssueClose;

	// Exempt by label
	for (const exempt of exemptLabels) {
		if (labels.includes(exempt)) {
			return { action: Action.SKIP, reason: `exempt label: ${exempt}` };
		}
	}
	// Exempt by assignee
	if (config.exemptAllAssignees && Array.isArray(item.assignees) && item.assignees.length > 0) {
		return { action: Action.SKIP, reason: `has assignee: ${item.assignees.map((a) => a.login).join(",")}` };
	}
	// Exempt by milestone
	if (config.exemptAllMilestones && item.milestone) {
		return { action: Action.SKIP, reason: `has milestone: ${item.milestone.title}` };
	}

	const isStale = labels.includes(staleLabel);

	if (isStale) {
		if (staleAddedAtMs == null) {
			// Label is present but we couldn't find when it was added (event log missing).
			// Treat as just-applied to avoid premature closure.
			return { action: Action.SKIP, reason: "stale label present but timestamp unknown; deferring" };
		}
		// If real activity happened AFTER stale was applied, un-stale it.
		if (lastActivityMs > staleAddedAtMs) {
			return { action: Action.UNSTALE, reason: "activity since stale-label was applied" };
		}
		// Otherwise check grace period.
		const daysSinceStale = daysSince(staleAddedAtMs, nowMs);
		if (daysSinceStale >= daysBeforeClose) {
			return { action: Action.CLOSE, reason: `${daysSinceStale.toFixed(1)} days since stale-label applied (threshold ${daysBeforeClose})` };
		}
		return { action: Action.SKIP, reason: `in grace period (${daysSinceStale.toFixed(1)}/${daysBeforeClose} days)` };
	}

	// Not yet stale — check inactivity.
	const daysInactive = daysSince(lastActivityMs, nowMs);
	if (daysInactive >= daysBeforeStale) {
		return { action: Action.MARK_STALE, reason: `${daysInactive.toFixed(1)} days inactive (threshold ${daysBeforeStale})` };
	}
	return { action: Action.SKIP, reason: `active (${daysInactive.toFixed(1)}/${daysBeforeStale} days)` };
}

/** Parse inputs into a typed config object. */
export function buildConfig(getInput) {
	return {
		daysBeforeIssueStale: Number(getInput("days_before_issue_stale") || 60),
		daysBeforeIssueClose: Number(getInput("days_before_issue_close") || 14),
		staleIssueLabel: getInput("stale_issue_label") || "stale",
		staleIssueMessage: getInput("stale_issue_message") || "",
		closeIssueMessage: getInput("close_issue_message") || "",
		daysBeforePrStale: Number(getInput("days_before_pr_stale") || 30),
		daysBeforePrClose: Number(getInput("days_before_pr_close") || 7),
		stalePrLabel: getInput("stale_pr_label") || "stale",
		stalePrMessage: getInput("stale_pr_message") || "",
		closePrMessage: getInput("close_pr_message") || "",
		exemptIssueLabels: parseLabelList(getInput("exempt_issue_labels")),
		exemptPrLabels: parseLabelList(getInput("exempt_pr_labels")),
		exemptAllMilestones: (getInput("exempt_all_milestones") || "true").toLowerCase() === "true",
		exemptAllAssignees: (getInput("exempt_all_assignees") || "true").toLowerCase() === "true",
		operationsPerRun: Number(getInput("operations_per_run") || 100),
		dryRun: (getInput("dry_run") || "false").toLowerCase() === "true"
	};
}
