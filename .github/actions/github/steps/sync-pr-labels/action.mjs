/**
 * @fileoverview Replace a pull request's labels with a given comma-separated
 * set. Node entrypoint for the sync-pr-labels action.
 * @module @cldmv/.github.github.steps.sync-pr-labels
 */

import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput } from "../../../common/common/core.mjs";

try {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const labels = getInput("labels", { required: true })
		.split(",")
		.map((label) => label.trim())
		.filter(Boolean);
	const mode = (getInput("mode") || "replace").toLowerCase();
	if (mode !== "replace" && mode !== "add") {
		throw new Error(`mode must be 'replace' or 'add', got "${mode}"`);
	}
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	if (labels.length === 0) {
		console.log("ℹ️ No labels to apply.");
		process.exit(0);
	}

	if (mode === "add") {
		// Additive: POST adds labels without removing existing ones.
		console.log(`🏷️ Adding labels (preserving existing): ${labels.join(",")}`);
		await api("POST", `/issues/${prNumber}/labels`, { labels }, { token, owner, repo });
		console.log(`✅ Labels applied: ${labels.join(",")}`);
	} else {
		// Replace mode: compute a delta and only touch labels that actually
		// changed. The earlier `PUT /labels` approach was semantically correct
		// but emitted noisy activity events — GitHub records a remove + add
		// pair for every label in the new set, even ones that already
		// matched. Each release-PR refresh would log:
		//   "added X Y Z and removed X Y Z"
		// even when the net set was unchanged. Diffing client-side avoids
		// this entirely: when the desired set already equals the current
		// set, we make zero API calls and the activity log stays quiet.
		const desired = new Set(labels);
		const currentArr = await api("GET", `/issues/${prNumber}/labels`, null, { token, owner, repo });
		const current = new Set((currentArr || []).map((l) => l?.name).filter(Boolean));

		const toAdd = [...desired].filter((l) => !current.has(l));
		const toRemove = [...current].filter((l) => !desired.has(l));

		if (toAdd.length === 0 && toRemove.length === 0) {
			console.log(`🏷️ Labels already in sync (${labels.join(",") || "<none>"}) — no API calls needed`);
		} else {
			console.log(`🏷️ Syncing label delta on PR #${prNumber}:`);
			if (toRemove.length) console.log(`   - removing: ${toRemove.join(",")}`);
			if (toAdd.length) console.log(`   + adding:   ${toAdd.join(",")}`);

			// Remove one-by-one — GitHub's per-label DELETE only fires a single
			// remove event each. URL-encode the name to handle labels with
			// spaces/colons/slashes (e.g. "type: ci", "priority: high").
			for (const name of toRemove) {
				await api("DELETE", `/issues/${prNumber}/labels/${encodeURIComponent(name)}`, null, { token, owner, repo });
			}
			// Add in one batched POST — fires per-label add events for only
			// the actual additions.
			if (toAdd.length) {
				await api("POST", `/issues/${prNumber}/labels`, { labels: toAdd }, { token, owner, repo });
			}
			console.log(`✅ Label delta applied. Final set: ${labels.join(",")}`);
		}
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
