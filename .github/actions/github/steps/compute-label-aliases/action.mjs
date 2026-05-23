/**
 * @fileoverview Compute raw release label aliases from a version bump type and
 * (optionally) the set of conventional-commit types present in the PR range.
 * Node entrypoint for the compute-label-aliases action.
 *
 * Aliases produced (resolved by resolve-labels against data/github-labels.json):
 *   - "release"                         (always)
 *   - bump type alias: "patch"|"minor"|"major"|"explicit"
 *   - per-commit-type aliases derived from `types-present`, mapped to the
 *     release-PR-owned label namespace:
 *       feat   → "feat"   (resolves to "type: feature request")
 *       fix    → "bug"    (resolves to "type: bug")
 *       perf   → "bug"
 *       revert → "bug"
 *     Other types (docs/refactor/chore/ci/test/style) are intentionally NOT
 *     mapped — those labels (when applicable) are owned by the PR labeler
 *     workflow (path-based), and mapping them here would fight that flow.
 *
 * Backward compat: when `types-present` is empty, falls back to the prior
 * "patch ⇒ also add 'bug'" shortcut so older callers don't regress.
 *
 * @module @cldmv/.github.github.steps.compute-label-aliases
 */

import { getInput, setOutput } from "../../../common/common/core.mjs";

const bumpType = getInput("bump-type");
const typesPresent = getInput("types-present", { default: "" })
	.split(",")
	.map((t) => t.trim().toLowerCase())
	.filter(Boolean);

/**
 * Map conventional commit types to release-PR-owned label aliases. Keep this
 * tight — only types that produce labels the release-PR machinery exclusively
 * owns. See the file header for the rationale on excluded types.
 */
const TYPE_TO_ALIAS = {
	feat: "feat",
	fix: "bug",
	perf: "bug",
	revert: "bug"
};

const aliases = new Set();
aliases.add("release");
if (bumpType) aliases.add(bumpType);

if (typesPresent.length > 0) {
	for (const t of typesPresent) {
		const a = TYPE_TO_ALIAS[t];
		if (a) aliases.add(a);
	}
} else if (bumpType === "patch") {
	// Backward-compat shortcut: a patch bump implies at least one fix/perf.
	aliases.add("bug");
}

setOutput("labels", [...aliases].join(","));
