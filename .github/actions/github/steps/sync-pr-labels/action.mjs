/**
 * @fileoverview Replace a pull request's labels with a given comma-separated
 * set. Node entrypoint for the sync-pr-labels action.
 * @module @cldmv/.github.github.steps.sync-pr-labels
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { api, parseRepo, paginate } from "../../api/_api/core.mjs";
import { getInput } from "../../../common/common/core.mjs";

/**
 * Ensure every label about to be applied exists in the repo with the catalog's
 * color/description, creating or correcting it first.
 *
 * `POST /issues/{n}/labels` silently auto-creates any label name it doesn't
 * recognize with a default gray color and empty description. On a freshly
 * onboarded repo — before its first org-label sync — that leaves every v4 flow
 * label flat gray until the weekly sweep runs. Seeding the target labels from
 * data/github-labels.json first means the apply step finds them already
 * correct. Non-destructive by design: it only touches the labels being applied
 * and never deletes anything (unlike the full org sync), so it is safe to run
 * on every PR-label apply. Entirely best-effort — a missing catalog or an
 * insufficient token scope logs a warning and lets the apply proceed unchanged.
 *
 * @param {string[]} labels - Label names about to be applied.
 * @param {{token: string, owner: string, repo: string}} ctx
 * @returns {Promise<void>}
 */
async function ensureCatalogLabels(labels, { token, owner, repo }) {
	let catalog;
	try {
		const catalogPath = join(dirname(fileURLToPath(import.meta.url)), "../../../../../data/github-labels.json");
		catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
	} catch (error) {
		console.log(`::warning::Skipping catalog label ensure — could not read the label catalog: ${error.message}`);
		return;
	}

	// Canonical name (lowercased) → catalog entry. Only labels being applied
	// that the catalog actually knows about are candidates.
	const byName = new Map();
	for (const entry of catalog) {
		if (entry && entry.name) byName.set(entry.name.toLowerCase(), entry);
	}
	const wanted = labels.map((name) => byName.get(name.toLowerCase())).filter(Boolean);
	if (wanted.length === 0) return;

	let existing;
	try {
		const { items } = await paginate("/labels", { token, owner, repo });
		existing = new Map((items || []).map((l) => [l.name.toLowerCase(), l]));
	} catch (error) {
		console.log(`::warning::Skipping catalog label ensure — could not list repo labels: ${error.message}`);
		return;
	}

	for (const label of wanted) {
		const current = existing.get(label.name.toLowerCase());
		const description = label.description ?? "";
		try {
			if (!current) {
				await api("POST", "/labels", { name: label.name, color: label.color, description }, { token, owner, repo });
				console.log(`🎨 Created catalog label \`${label.name}\` (#${label.color})`);
			} else if ((current.color || "").toLowerCase() !== (label.color || "").toLowerCase() || (current.description ?? "") !== description) {
				await api(
					"PATCH",
					`/labels/${encodeURIComponent(current.name)}`,
					{ new_name: label.name, color: label.color, description },
					{ token, owner, repo }
				);
				console.log(`🎨 Corrected catalog label \`${label.name}\` (#${label.color})`);
			}
		} catch (error) {
			console.log(`::warning::Could not ensure catalog label \`${label.name}\`: ${error.message}`);
		}
	}
}

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
	const managedLabels = getInput("managed-labels", { default: "" })
		.split(",")
		.map((l) => l.trim())
		.filter(Boolean);
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	if (labels.length === 0) {
		console.log("ℹ️ No labels to apply.");
		process.exit(0);
	}

	// Seed/correct the target labels from the catalog before applying them, so a
	// freshly onboarded repo doesn't get flat-gray auto-created labels (best-effort).
	const ensureCatalog = (getInput("ensure-catalog-labels", { default: "true" }) || "true").toLowerCase() !== "false";
	if (ensureCatalog) {
		await ensureCatalogLabels(labels, { token, owner, repo });
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
		//
		// `managed-labels` SCOPE: when set, removals are restricted to that
		// allowlist. Labels OUTSIDE the allowlist (e.g. `type: ci` / `area: *`
		// added by the path-based PR labeler workflow) are left alone — without
		// this, the release-PR refresh would strip them every cycle and the
		// labeler would re-add them, producing the "added X removed X" churn
		// the delta-diff was supposed to silence. Additions are still based
		// purely on `desired` minus `current` — the caller is trusted to only
		// add labels it owns.
		const desired = new Set(labels);
		const currentArr = await api("GET", `/issues/${prNumber}/labels`, null, { token, owner, repo });
		const current = new Set((currentArr || []).map((l) => l?.name).filter(Boolean));

		const toAdd = [...desired].filter((l) => !current.has(l));
		const removalScope = managedLabels.length > 0 ? new Set(managedLabels) : null;
		const toRemove = [...current].filter((l) => !desired.has(l) && (removalScope === null || removalScope.has(l)));

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
