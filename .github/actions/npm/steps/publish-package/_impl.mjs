/**
 * @fileoverview Pure, side-effect-free helpers for the publish-package action,
 * factored out so the fragile publish-error classification can be unit-tested
 * (see test.mjs) without running a real publish. Dependency-free.
 * @module @cldmv/.github.npm.steps.publish-package._impl
 */

/**
 * Whether a failed `npm publish` output means the EXACT version is already
 * published — an idempotent no-op, not a real failure.
 *
 * npm reports this as a 403 whose wording varies across versions and
 * pluralizes with the version list, e.g.
 *   "npm error You cannot publish over the previously published versions: 3.12.2."
 * The previous check used the literal substring
 *   "Cannot publish over previously published version"
 * which did NOT match that message — wrong case ("Cannot" vs npm's "cannot"),
 * missing the word "the", and singular "version" vs npm's plural "versions". So
 * the already-published case fell through to the 403/auth branch and FAILED the
 * job, breaking satellite/extra-package publish idempotency on a re-run or a
 * stray master push (the reported slothlet-i18n / slothlet-types @3.12.2
 * failure — those satellites are intentionally not version-gated, so they reach
 * the publish and must skip cleanly when the version already exists). Match the
 * stable core phrase case-insensitively instead of a brittle exact substring.
 *
 * @public
 * @param {string} output - Combined stdout/stderr from the publish command.
 * @returns {boolean}
 */
export function isVersionAlreadyPublishedError(output) {
	return /cannot publish over.*previously published version/i.test(String(output ?? ""));
}
