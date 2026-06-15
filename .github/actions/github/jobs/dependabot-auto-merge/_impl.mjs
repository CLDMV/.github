/**
 * @fileoverview Pure, side-effect-free helpers for the dependabot-auto-merge
 * action, factored out so the safety-critical parsing can be unit-tested
 * (see test.mjs) without running the action. Dependency-free.
 * @module @cldmv/.github.github.jobs.dependabot-auto-merge._impl
 */

/**
 * Parse a Dependabot PR title ("… from X.Y.Z to A.B.C …") into a semver bump.
 * @public
 * @param {string} title - PR title.
 * @returns {{ type: "major"|"minor"|"patch", from: string, to: string } | null}
 *   The bump, or null when the title has no parseable version transition.
 */
export function parseSemverBump(title) {
	const match = String(title ?? "").match(/from (\d+)\.(\d+)\.(\d+)\b.*?\bto (\d+)\.(\d+)\.(\d+)\b/);
	if (!match) return null;
	const [, om, on, op, nm, nn, np] = match.map((s, i) => (i === 0 ? s : Number(s)));
	if (om !== nm) return { type: "major", from: `${om}.${on}.${op}`, to: `${nm}.${nn}.${np}` };
	if (on !== nn) return { type: "minor", from: `${om}.${on}.${op}`, to: `${nm}.${nn}.${np}` };
	return { type: "patch", from: `${om}.${on}.${op}`, to: `${nm}.${nn}.${np}` };
}

/**
 * Extract the required-status-check contexts from a `GET /rules/branches/<b>`
 * response (the effective rules from classic protection + rulesets). Tolerant
 * of a non-array or malformed payload — anything unexpected yields no contexts.
 * @public
 * @param {unknown} rules - The parsed API response.
 * @returns {string[]} The required check context names, trimmed; blank,
 *   whitespace-only, missing, or non-string contexts are dropped.
 */
export function requiredCheckContextsFromRules(rules) {
	const effective = Array.isArray(rules) ? rules : [];
	return effective
		.filter((r) => r && r.type === "required_status_checks")
		.flatMap((r) => (r.parameters && Array.isArray(r.parameters.required_status_checks) ? r.parameters.required_status_checks : []))
		.map((c) => (c && typeof c.context === "string" ? c.context.trim() : ""))
		.filter((ctx) => ctx.length > 0);
}

/**
 * Whether an `api()` error message denotes a 404 (branch has no effective rules)
 * versus any other failure (permission/network → protection state unknown).
 * `api()` throws `<METHOD> <path> -> <status>: <body>`.
 * @public
 * @param {unknown} message - The thrown error's message.
 * @returns {boolean} True only for a 404.
 */
export function isNotFoundError(message) {
	return typeof message === "string" && message.includes("-> 404");
}
