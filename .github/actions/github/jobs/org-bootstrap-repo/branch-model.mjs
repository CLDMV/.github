/**
 * @fileoverview `branch-model` org custom property helpers for org-bootstrap-repo.
 * The property records where a repo's work lands (`v4` → next, `dev-trunk` → dev,
 * `legacy` / `custom` → their own flow, `none` → no release flow). Kept separate
 * from action.mjs (which runs main() on import) so it can be unit-tested with a
 * fake `api` function.
 *
 * @module @cldmv/.github.github.jobs.org-bootstrap-repo.branch-model
 */

export const BRANCH_MODEL_PROPERTY = "branch-model";
export const BRANCH_MODELS = ["v4", "dev-trunk", "legacy", "custom", "none"];
/** Models whose own flow the v4 rulesets and settings would break. */
export const PROTECTED_MODELS = ["legacy", "custom"];

/**
 * Validate the `branch_model` input. Empty means "leave the property alone".
 *
 * @param {string} raw - Raw input value.
 * @returns {string} The normalized value, or "" when unset.
 */
export function parseBranchModel(raw) {
	const value = (raw || "").trim().toLowerCase();
	if (value && !BRANCH_MODELS.includes(value)) {
		throw new Error(`Invalid branch_model: "${raw}" (expected one of: ${BRANCH_MODELS.join(", ")})`);
	}
	return value;
}

/**
 * Read the repo's current `branch-model` value.
 *
 * @param {(method: string, path: string) => Promise<any>} call - API caller with absolute paths.
 * @param {string} owner - Repo owner.
 * @param {string} repo - Repo name.
 * @returns {Promise<{ value: string|null, error: string }>} `value` is null when unset;
 *   `error` is non-empty when the read failed (no permission, not an org repo, …).
 */
export async function readBranchModel(call, owner, repo) {
	try {
		const values = await call("GET", `/repos/${owner}/${repo}/properties/values`);
		const entry = (Array.isArray(values) ? values : []).find((p) => p.property_name === BRANCH_MODEL_PROPERTY);
		const value = entry?.value;
		return { value: typeof value === "string" && value ? value : null, error: "" };
	} catch (err) {
		return { value: null, error: err.message };
	}
}

/**
 * Decide whether the bootstrap must skip this repo because of its branch model.
 *
 * @param {{ current: string|null, requested: string, force: boolean }} opts
 * @returns {string} The skip reason, or "" to proceed.
 */
export function branchModelSkipReason({ current, requested, force }) {
	if (force) return "";
	if (current && PROTECTED_MODELS.includes(current)) {
		return `branch-model is \`${current}\` — its own flow would break under the v4 baseline (re-run with force to override)`;
	}
	if (requested && PROTECTED_MODELS.includes(requested)) {
		return `requested branch_model \`${requested}\` keeps its own flow — set the property in the org settings or the backfill, or re-run with force`;
	}
	return "";
}

/**
 * Body for `PATCH /orgs/{org}/properties/values` setting one repo's branch model.
 *
 * @param {string} repo - Repo name.
 * @param {string} value - Branch model value.
 * @returns {object} Request body.
 */
export function branchModelPatchBody(repo, value) {
	return {
		repository_names: [repo],
		properties: [{ property_name: BRANCH_MODEL_PROPERTY, value }]
	};
}
