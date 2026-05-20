/**
 * @fileoverview Apply stale-sweep decisions: add/remove labels, post
 * comments, close items. Each function is dry-run aware. Talks to the
 * GitHub REST API via the shared `api` helper.
 * @module @cldmv/.github.github.jobs.stale-sweep.actor
 */

import { api } from "../../api/_api/core.mjs";

/** Apply the stale label and post a notice comment (idempotent on rerun). */
export async function markStale({ owner, repo, token, item, label, message, dryRun }) {
	const number = item.number;
	console.log(`  → ${dryRun ? "[dry-run] " : ""}MARK STALE: #${number} "${item.title}"`);
	if (dryRun) return;

	await api(
		"POST",
		`/issues/${number}/labels`,
		{ labels: [label] },
		{ token, owner, repo }
	);

	if (message) {
		// Idempotency: skip the comment if the most-recent bot comment already says this
		const recent = await api("GET", `/issues/${number}/comments?per_page=10&sort=created&direction=desc`, null, { token, owner, repo });
		const alreadyCommented = Array.isArray(recent) && recent.some((c) => c.body && c.body.includes(message.slice(0, 80)));
		if (!alreadyCommented) {
			await api("POST", `/issues/${number}/comments`, { body: message }, { token, owner, repo });
		}
	}
}

/** Close item and post the closing comment. */
export async function closeItem({ owner, repo, token, item, message, dryRun }) {
	const number = item.number;
	console.log(`  → ${dryRun ? "[dry-run] " : ""}CLOSE: #${number} "${item.title}"`);
	if (dryRun) return;

	if (message) {
		await api("POST", `/issues/${number}/comments`, { body: message }, { token, owner, repo });
	}
	await api("PATCH", `/issues/${number}`, { state: "closed", state_reason: "not_planned" }, { token, owner, repo });
}

/** Remove the stale label because activity resumed. */
export async function unstale({ owner, repo, token, item, label, dryRun }) {
	const number = item.number;
	console.log(`  → ${dryRun ? "[dry-run] " : ""}UN-STALE: #${number} "${item.title}"`);
	if (dryRun) return;

	try {
		await api("DELETE", `/issues/${number}/labels/${encodeURIComponent(label)}`, null, { token, owner, repo });
	} catch (err) {
		// Label may have been removed between scan and apply — ignore 404.
		if (!err.message.includes("404")) throw err;
	}
}
