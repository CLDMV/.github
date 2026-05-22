/**
 * @fileoverview Merge a source ref into a target branch via the GitHub
 * Merges API. Implements §7.2 of the v4 design — after a hotfix lands on
 * master, run this to preserve accumulated feature work on `next`.
 *
 * Why the API and not a `git push`: a push authenticated as the bot App is
 * rejected by a protected branch's ruleset (GH013 "Changes must be made
 * through a pull request") even when the App is in the bypass list with mode
 * Always — GitHub honors an App's ruleset bypass on the REST API path but not
 * on raw git. force-reset-branch hit the same wall and switched to the Git
 * Refs API for exactly this reason.
 *
 * Pure helpers are exported for test.mjs; side-effecting main is gated to
 * script entry.
 *
 * @module @cldmv/.github.github.steps.merge-master-into-branch
 */

import { parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs, getBooleanInput } from "../../../common/common/core.mjs";

/**
 * Build the JSON body for `POST /repos/{owner}/{repo}/merges`.
 *
 * @public
 * @param {object} args
 * @param {string} args.targetBranch
 * @param {string} args.sourceRef
 * @param {string} [args.commitMessage] - Override commit message.
 * @returns {{ base: string, head: string, commit_message: string }}
 */
export function buildMergePayload({ targetBranch, sourceRef, commitMessage }) {
	const message = commitMessage && commitMessage.trim()
		? commitMessage.trim()
		: `Merge ${sourceRef} into ${targetBranch}`;
	return { base: targetBranch, head: sourceRef, commit_message: message };
}

/**
 * Interpret a Merges API response. GitHub defines three relevant outcomes:
 *   - 201 Created: merge happened; body has { sha, ... }
 *   - 204 No Content: nothing to merge (already up-to-date)
 *   - 409 Conflict: merge conflict; we treat this as a failure
 *
 * 4xx outcomes other than 409 (404 missing branch, 422 bad ref, etc.) are
 * reported as failures with the original status preserved.
 *
 * @public
 * @param {number} status - HTTP status code.
 * @param {object|null} body - Parsed JSON body (null on 204).
 * @returns {{ performed: boolean, sha: string, conflict: boolean, error: string }}
 */
export function interpretMergeResponse(status, body) {
	if (status === 201) {
		return { performed: true, sha: body?.sha || "", conflict: false, error: "" };
	}
	if (status === 204) {
		return { performed: false, sha: "", conflict: false, error: "" };
	}
	if (status === 409) {
		return { performed: false, sha: "", conflict: true, error: "Merge conflict (409) — manual resolution required" };
	}
	const detail = body && typeof body === "object" ? JSON.stringify(body) : String(body || "");
	return { performed: false, sha: "", conflict: false, error: `Unexpected status ${status}: ${detail}` };
}

// ---- side-effecting main flow (gated to script entry only) ----------------

async function callMergesApi({ owner, repo, payload, token }) {
	const url = `https://api.github.com/repos/${owner}/${repo}/merges`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${token}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2026-03-10"
		},
		body: JSON.stringify(payload)
	});
	const status = res.status;
	const body = status === 204 ? null : await res.json().catch(() => null);
	return { status, body };
}

async function main() {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const targetBranch = getInput("target-branch", { required: true });
	const sourceRef = getInput("source-ref") || "master";
	const commitMessage = getInput("commit-message");
	const dryRun = getBooleanInput("dry-run", false);
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const payload = buildMergePayload({ targetBranch, sourceRef, commitMessage });
	console.log(`▶️  POST /repos/${owner}/${repo}/merges — merging '${sourceRef}' into '${targetBranch}'`);
	console.log(`   commit_message: "${payload.commit_message}"`);

	if (dryRun) {
		console.log("ℹ️  dry-run=true — skipping API call.");
		setOutputs({ "merge-sha": "", "merge-performed": "false", "had-conflict": "false" });
		return;
	}

	const { status, body } = await callMergesApi({ owner, repo, payload, token });
	const result = interpretMergeResponse(status, body);

	setOutputs({
		"merge-sha": result.sha,
		"merge-performed": String(result.performed),
		"had-conflict": String(result.conflict)
	});

	if (result.error) {
		console.error(`::error::${result.error}`);
		process.exit(1);
	}

	if (result.performed) {
		console.log(`✅ Merge commit created: ${result.sha}`);
	} else {
		console.log(`ℹ️  Already up-to-date — nothing to merge.`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
