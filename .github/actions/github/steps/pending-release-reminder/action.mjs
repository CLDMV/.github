/**
 * @fileoverview File a deduped tracking issue when a release has been sitting
 * unmerged too long. Implements §6.6 of the v4 design. Pure helpers are
 * exported for test.mjs; the side-effecting main is gated to script entry.
 *
 * @module @cldmv/.github.github.steps.pending-release-reminder
 */

import { execSync } from "node:child_process";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

/**
 * Whole days between two ISO timestamps (floored, never negative).
 * @public
 */
export function ageInDays(fromISO, nowISO) {
	const from = Date.parse(fromISO);
	const now = Date.parse(nowISO);
	if (Number.isNaN(from) || Number.isNaN(now)) return 0;
	return Math.max(0, Math.floor((now - from) / 86400000));
}

/**
 * ISO-8601 week-numbering { year, week } for a Date (UTC).
 * @public
 */
export function isoWeek(d) {
	const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
	date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const fdNum = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - fdNum + 3);
	const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
	return { year: date.getUTCFullYear(), week };
}

/**
 * Bucket label for a date at the given granularity.
 * @public
 * @param {Date} date
 * @param {"week"|"day"|"month"} window
 * @returns {string}
 */
export function bucketLabel(date, window) {
	const y = date.getUTCFullYear();
	const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(date.getUTCDate()).padStart(2, "0");
	if (window === "day") return `${y}-${mm}-${dd}`;
	if (window === "month") return `${y}-${mm}`;
	const { year, week } = isoWeek(date); // default: week
	return `${year}-W${String(week).padStart(2, "0")}`;
}

/**
 * Dedup key embedded in the reminder issue title — one reminder per branch
 * per bucket.
 * @public
 */
export function dedupKey(branch, date, window) {
	return `release-reminder-${branch}-${bucketLabel(date, window)}`;
}

/** @public */
export function shouldRemind(ageDays, thresholdDays) {
	return Number(ageDays) > Number(thresholdDays);
}

/** @public */
export function buildIssueTitle(branch, key) {
	return `⏰ Pending ${branch} release reminder [${key}]`;
}

/** @public */
export function buildIssueBody({ branch, prNumber, ageDays, thresholdDays, key }) {
	return [
		`The \`${branch} → master\` release PR (#${prNumber}) has been open with unreleased work for **${ageDays} day(s)** — past the ${thresholdDays}-day threshold for the \`${branch}\` lane.`,
		``,
		`Either merge it to publish, or close it if the work isn't ready.`,
		``,
		`<sub>Deduped per ${key}. Auto-filed by the pending-release-reminder workflow.</sub>`
	].join("\n");
}

// ---- side-effecting main (gated to script entry) --------------------------

function lastReleaseISO() {
	try {
		// Most recent release commit on the checked-out branch (master).
		const out = execSync(`git log --grep='^release:' -n 1 --format=%cI`, {
			encoding: "utf8"
		}).trim();
		return out || null;
	} catch {
		return null;
	}
}

async function findReleasePR(owner, repo, head, token) {
	const prs = await api("GET", `/pulls?state=open&base=master&head=${owner}:${head}&per_page=5`, null, {
		token,
		owner,
		repo
	});
	return Array.isArray(prs) && prs.length ? prs[0] : null;
}

async function reminderIssueExists(owner, repo, key, token) {
	// /issues returns PRs too — filter to real issues whose title carries the key.
	const issues = await api("GET", `/issues?state=open&per_page=100`, null, { token, owner, repo });
	return (issues || []).some((i) => !i.pull_request && typeof i.title === "string" && i.title.includes(key));
}

async function fileReminder({ owner, repo, token, branch, pr, ageDays, thresholdDays, key, labels }) {
	const title = buildIssueTitle(branch, key);
	const body = buildIssueBody({ branch, prNumber: pr.number, ageDays, thresholdDays, key });
	const issue = await api("POST", `/issues`, { title, body, labels }, { token, owner, repo });
	await api(
		"POST",
		`/issues/${pr.number}/comments`,
		{ body: `⏰ This release has been pending ${ageDays} day(s) — filed tracking issue #${issue.number}.` },
		{ token, owner, repo }
	);
	console.log(`📌 Filed reminder issue #${issue.number} for ${branch} (PR #${pr.number}).`);
	return issue.number;
}

async function main() {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const window = (getInput("dedup-window") || "week").toLowerCase();
	const labels = (getInput("issue-labels") || "")
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean);
	const thresholds = {
		next: parseInt(getInput("next-threshold-days") || "14", 10),
		hotfixes: parseInt(getInput("hotfixes-threshold-days") || "3", 10)
	};
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const lastRelease = lastReleaseISO();
	if (!lastRelease) {
		console.log("ℹ️ No release commit found on master — nothing to age against.");
		setOutputs({ "reminders-filed": "0" });
		return;
	}
	const now = new Date();
	const age = ageInDays(lastRelease, now.toISOString());
	console.log(`📅 Last release: ${lastRelease} (${age} day(s) ago)`);

	let filed = 0;
	for (const branch of ["next", "hotfixes"]) {
		const threshold = thresholds[branch];
		if (!shouldRemind(age, threshold)) {
			console.log(`✅ ${branch}: ${age}d ≤ ${threshold}d threshold — no reminder.`);
			continue;
		}
		const pr = await findReleasePR(owner, repo, branch, token);
		if (!pr) {
			console.log(`✅ ${branch}: no open release PR — nothing pending.`);
			continue;
		}
		const key = dedupKey(branch, now, window);
		if (await reminderIssueExists(owner, repo, key, token)) {
			console.log(`🔁 ${branch}: reminder already filed for ${key} — skipping.`);
			continue;
		}
		await fileReminder({ owner, repo, token, branch, pr, ageDays: age, thresholdDays: threshold, key, labels });
		filed++;
	}

	setOutputs({ "reminders-filed": String(filed) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
