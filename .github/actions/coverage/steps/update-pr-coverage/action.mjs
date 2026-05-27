/**
 * @fileoverview Compute coverage stats from a coverage-summary.json and
 * inject (or update) a coverage badge block in the pull request body. Node
 * entrypoint for the update-pr-coverage action (previously a node -e block
 * plus an actions/github-script block).
 * @module @cldmv/.github.coverage.steps.update-pr-coverage
 */

import fs from "node:fs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";
import { getInput, getEventPayload } from "../../../common/common/core.mjs";

const START = "<!-- coverage-start -->";
const END = "<!-- coverage-end -->";

// Legacy marker pair from the original implementation. Strip any stray
// `coverage-badge-*` block from in-flight PR bodies on first run after
// rename, so we don't end up with two coverage blocks side-by-side.
// Safe to remove after all currently-open release PRs have shipped.
const LEGACY_START = "<!-- coverage-badge-start -->";
const LEGACY_END = "<!-- coverage-badge-end -->";

try {
	const summaryPath = getInput("coverage-summary-path", { required: true });
	const nodeVersion = getInput("node-version", { default: "lts/*" });
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const { owner, repo } = parseRepo(getInput("repository", { required: true }));

	const event = getEventPayload();
	const prNumber = event.pull_request?.number ?? event.number;
	if (!prNumber) {
		console.log("No pull request in context — skipping coverage PR update.");
		process.exit(0);
	}

	// Compute per-metric percentages and the average.
	const total = JSON.parse(fs.readFileSync(summaryPath, "utf8")).total;
	const fmt = (metric) => (metric.total === 0 ? "100.0" : metric.pct.toFixed(1));
	const st = fmt(total.statements);
	const br = fmt(total.branches);
	const fn = fmt(total.functions);
	const ln = fmt(total.lines);
	const avg = ((Number.parseFloat(st) + Number.parseFloat(br) + Number.parseFloat(fn) + Number.parseFloat(ln)) / 4).toFixed(1);

	const color = avg >= 90 ? "brightgreen" : avg >= 75 ? "green" : avg >= 60 ? "yellow" : "red";
	const badgeUrl =
		`https://img.shields.io/badge/coverage-${encodeURIComponent(`${avg}%`)}-${color}` +
		"?style=for-the-badge&logo=vitest&logoColor=white";

	const sha = (process.env.GITHUB_SHA || "").slice(0, 7);
	const block = [
		START,
		"",
		`![coverage](${badgeUrl})`,
		"",
		"| Metric | Coverage |",
		"|--------|----------|",
		`| Statements | ${st}% |`,
		`| Branches   | ${br}% |`,
		`| Functions  | ${fn}% |`,
		`| Lines      | ${ln}% |`,
		"",
		`*Avg: **${avg}%** · \`${sha}\` · Node ${nodeVersion}*`,
		"",
		END
	].join("\n");

	const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
	let currentBody = pr.body || "";

	// One-time migration: strip any leftover legacy `coverage-badge-*`
	// block from in-flight PR bodies so the new `coverage-*` block doesn't
	// stack alongside it. Also handles the surrounding `\n\n---\n\n`
	// separator that the original append path inserted, so the body
	// doesn't accumulate orphan horizontal rules across migrations.
	{
		const legacyStart = currentBody.indexOf(LEGACY_START);
		if (legacyStart !== -1) {
			const legacyEnd = currentBody.indexOf(LEGACY_END, legacyStart + LEGACY_START.length);
			if (legacyEnd !== -1) {
				const blockEnd = legacyEnd + LEGACY_END.length;
				// Eat trailing newlines + horizontal-rule separator that the
				// legacy append path likely wrote ahead of the block.
				let stripStart = legacyStart;
				const beforeBlock = currentBody.slice(0, legacyStart);
				const sepMatch = beforeBlock.match(/\n\n-{3,}\n\n$/);
				if (sepMatch) stripStart -= sepMatch[0].length;
				currentBody = currentBody.slice(0, stripStart) + currentBody.slice(blockEnd);
				console.log("Stripped legacy `coverage-badge-*` block (migration).");
			}
		}
	}

	let newBody;
	if (currentBody.includes(START) && currentBody.includes(END)) {
		// Replace the existing block between the markers.
		const before = currentBody.slice(0, currentBody.indexOf(START));
		const after = currentBody.slice(currentBody.indexOf(END) + END.length);
		newBody = before + block + after;
	} else {
		// Append the block, separated by a horizontal rule when the body is non-empty.
		const separator = currentBody.trimEnd().length > 0 ? "\n\n---\n\n" : "";
		newBody = currentBody + separator + block;
	}

	if (newBody === currentBody) {
		console.log("PR body unchanged — skipping update.");
		process.exit(0);
	}

	await api("PATCH", `/pulls/${prNumber}`, { body: newBody }, { token, owner, repo });
	console.log("PR description updated with coverage badge.");
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
