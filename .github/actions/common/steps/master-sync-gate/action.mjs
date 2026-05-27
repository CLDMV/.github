/**
 * @fileoverview Detect whether the current branch's tip SHA already matches
 * the repo's default branch (master/main). Used to short-circuit workflows
 * on `next` / `hotfixes` after a release merge: the bot force-syncs those
 * branches to master, the resulting push event fires every CI workflow,
 * and none of them have anything to do — they're inspecting a SHA that
 * already shipped.
 *
 * Resolution order:
 *   1. GET /repos/{owner}/{repo}/branches/<default_branch>     (input, default "master")
 *   2. GET /repos/{owner}/{repo}/branches/main                 (fallback)
 *
 * Emits `is_master_sync=true` when the resolved tip equals GITHUB_SHA,
 * `false` otherwise. On API errors emits `false` so workflows fail open
 * (run normally) rather than silently skipping.
 *
 * @module @cldmv/.github.common.steps.master-sync-gate
 */

import { getInput, setOutputs } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";

async function getBranchSha({ token, owner, repo, branch }) {
	try {
		const data = await api("GET", `/branches/${encodeURIComponent(branch)}`, null, { token, owner, repo });
		return data?.commit?.sha || "";
	} catch (err) {
		if (err.message.includes("404")) return "";
		throw err;
	}
}

try {
	const defaultBranch = getInput("default_branch", { default: "master" });
	const token = getInput("github-token", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);
	const headSha = process.env.GITHUB_SHA || "";

	let masterSha = await getBranchSha({ token, owner, repo, branch: defaultBranch });
	let resolvedBranch = defaultBranch;
	if (!masterSha && defaultBranch !== "main") {
		masterSha = await getBranchSha({ token, owner, repo, branch: "main" });
		resolvedBranch = "main";
	}

	if (!masterSha) {
		console.log(`⚠️ Could not resolve default branch tip (tried ${defaultBranch}${defaultBranch !== "main" ? " and main" : ""}). Emitting is_master_sync=false (fail open).`);
		setOutputs({ is_master_sync: "false" });
		process.exit(0);
	}

	const match = masterSha === headSha;
	console.log(`📍 Comparing tips:`);
	console.log(`  ${resolvedBranch}: ${masterSha}`);
	console.log(`  GITHUB_SHA: ${headSha}`);
	console.log(`📌 is_master_sync=${match}`);
	if (match) console.log(`::notice::Branch tip matches ${resolvedBranch} — workflow can short-circuit.`);
	setOutputs({ is_master_sync: match ? "true" : "false" });
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
