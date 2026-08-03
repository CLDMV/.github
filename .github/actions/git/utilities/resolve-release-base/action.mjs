/**
 * @fileoverview Resolve the base branch for a release PR. The release path used
 * to hardcode `master`; this action resolves it in a fixed priority order so a
 * repo whose default branch is `main` (or anything else) releases against the
 * right branch without per-repo workflow edits.
 *
 * Priority (first non-empty, trimmed, wins):
 *   1. `override`    — the `CLDMV_RELEASE_BASE` Actions variable (per-repo override)
 *   2. `configured`  — the reusable release workflow's `default_branch` input (caller YAML)
 *   3. `detected`    — GitHub API `repository.default_branch` (auto-detected)
 *   4. `fallback`    — hard fallback (`master`)
 *
 * The pure `resolveBase()` is exported for test.mjs; the side-effecting entry is
 * gated to script entry (matches merge-master-into-branch / force-reset-branch).
 * The API lookup for `detected` is performed ONLY when neither `override` nor
 * `configured` is set — when one of those short-circuits the result, the network
 * round-trip is pointless.
 *
 * @module @cldmv/.github.git.utilities.resolve-release-base
 */

import { api, parseRepo } from "../../../github/api/_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

/**
 * Pick the release base from the four ordered candidates. Pure: no I/O, so the
 * priority order is unit-testable without a network or a git checkout.
 *
 * @public
 * @param {object} args
 * @param {string} [args.override]   - Highest priority (the Actions variable).
 * @param {string} [args.configured] - Caller YAML input.
 * @param {string} [args.detected]   - API-detected default_branch.
 * @param {string} [args.fallback]   - Hard fallback.
 * @returns {{ base: string, source: "override"|"configured"|"detected"|"fallback"|"none" }}
 */
export function resolveBase({ override, configured, detected, fallback } = {}) {
	const candidates = [
		["override", override],
		["configured", configured],
		["detected", detected],
		["fallback", fallback]
	];
	for (const [source, value] of candidates) {
		const trimmed = typeof value === "string" ? value.trim() : "";
		if (trimmed) return { base: trimmed, source };
	}
	return { base: "", source: "none" };
}

// ---- side-effecting main (gated to script entry) --------------------------

async function main() {
	const override = getInput("override");
	const configured = getInput("configured");
	const fallback = getInput("fallback") || "master";
	const token = getInput("github-token");

	// Only hit the API when neither override nor configured already decides the
	// result — otherwise the detected value would never be used anyway.
	let detected = "";
	if (!override && !configured) {
		try {
			const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);
			console.log(`🔍 Neither override nor configured set — detecting default branch for ${owner}/${repo}…`);
			const repoInfo = await api("GET", "", null, { token, owner, repo });
			detected = (repoInfo && repoInfo.default_branch) || "";
			console.log(`🔍 API default_branch: ${detected || "(none)"}`);
		} catch (error) {
			console.log(`⚠️ Could not detect default branch via API (${error.message}) — falling back.`);
		}
	}

	const { base, source } = resolveBase({ override, configured, detected, fallback });
	console.log(`🎯 Release base branch: ${base} (source: ${source})`);
	setOutput("default-branch", base);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
