/**
 * @fileoverview Release PR title helpers: build `release: vX.Y.Z - <suffix>`,
 * tell a generated title from one a maintainer edited by hand, and cap the
 * finished title's length.
 *
 * A release PR title becomes the squash commit's subject on the release
 * branch. Tooling refreshes the PR on every push to the integration branch,
 * and used to overwrite the title each time, so a hand-edited title never
 * survived to the merge (CLDMV/.github#523). The refresh now keeps the text of
 * a hand-edited title and only rewrites its version prefix.
 *
 * @module @cldmv/.github.github.utilities.release-title
 */

/** Longest finished title, in characters, before it is cut with "…". */
export const RELEASE_TITLE_MAX = 72;

/** `release: vX.Y.Z` (or `release!:`) plus an optional ` - ` / `:` separator. */
const PREFIX_RE = /^release!?:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\s*[-–:]\s*|\s+|$)/i;

/** Collapse runs of whitespace (newlines included) into one space and trim. */
function normalize(s) {
	return String(s ?? "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Cap a finished title at `max` characters. A longer title is cut at the last
 * word boundary that fits (or hard-cut when there is none in the second half),
 * trailing spaces are trimmed, and "…" is appended. The result, "…" included,
 * is at most `max` characters.
 * @param {string} title - The finished title.
 * @param {number} [max=RELEASE_TITLE_MAX]
 * @returns {string}
 */
export function truncateTitle(title, max = RELEASE_TITLE_MAX) {
	const cleaned = normalize(title);
	if (cleaned.length <= max) return cleaned;
	const slice = cleaned.slice(0, max - 1);
	const lastSpace = slice.lastIndexOf(" ");
	const cut = lastSpace > Math.floor(max / 2) ? slice.slice(0, lastSpace) : slice;
	return cut.trimEnd() + "…";
}

/**
 * Split a release PR title into its version and suffix. A title without the
 * `release: vX.Y.Z` prefix has no version, and its whole text is the suffix.
 * @param {string} title
 * @returns {{ version: string, suffix: string, hasPrefix: boolean }}
 */
export function splitReleaseTitle(title) {
	const t = normalize(title);
	const m = PREFIX_RE.exec(t);
	if (!m) return { version: "", suffix: t, hasPrefix: false };
	return { version: m[1], suffix: t.slice(m[0].length).trim(), hasPrefix: true };
}

/**
 * Build the finished title for `version` and `suffix`, truncated last.
 * @param {string} version - Version without a leading "v".
 * @param {string} [suffix]
 * @returns {string}
 */
export function buildReleaseTitle(version, suffix = "") {
	const v = String(version || "").replace(/^v/i, "");
	const s = normalize(suffix);
	return truncateTitle(s ? `release: v${v} - ${s}` : `release: v${v}`);
}

/**
 * Whether `suffix` is one the tooling generated from one of `candidates`:
 * equal to a candidate, or a cut-down candidate ending in "…" (any truncation
 * rule, old or new). An empty suffix counts as generated (the plain
 * `release: vX.Y.Z` form).
 * @param {string} suffix - Current title's text after `release: vX.Y.Z - `.
 * @param {string[]} candidates - Suffixes the release range's commits would generate.
 * @returns {boolean}
 */
export function isGeneratedSuffix(suffix, candidates) {
	const s = normalize(suffix);
	if (!s) return true;
	const list = (candidates || []).map(normalize).filter(Boolean);
	if (s.endsWith("…")) {
		const stem = s.slice(0, -1).trimEnd();
		if (!stem) return true;
		return list.some((c) => c.startsWith(stem));
	}
	return list.includes(s);
}

/**
 * Decide the title a release PR refresh should set.
 *
 * - The current title's suffix matches what some commit in the range would
 *   generate → it was generated, so regenerate it from `generatedSuffix`.
 * - It matches none → a maintainer wrote it; keep the text.
 *
 * Either way the title starts with `release: v<version>` (a stale version is
 * replaced and a removed prefix restored) and the length cap is applied last.
 *
 * @param {object} args
 * @param {string} [args.currentTitle] - The PR's title right now ("" for a new PR).
 * @param {string} args.version - Version the release will carry.
 * @param {string} [args.generatedSuffix] - The suffix generated from the current commits.
 * @param {string[]} [args.candidates] - Every suffix a commit in the range would generate.
 * @returns {{ title: string, source: "generated" | "manual" }}
 */
export function resolveReleaseTitle({ currentTitle = "", version, generatedSuffix = "", candidates = [] }) {
	const current = normalize(currentTitle);
	if (!current) return { title: buildReleaseTitle(version, generatedSuffix), source: "generated" };
	const { suffix } = splitReleaseTitle(current);
	if (isGeneratedSuffix(suffix, [...candidates, generatedSuffix])) {
		return { title: buildReleaseTitle(version, generatedSuffix), source: "generated" };
	}
	return { title: buildReleaseTitle(version, suffix), source: "manual" };
}

/**
 * Parse a `title-candidates` action input (a JSON array of strings).
 * Anything unreadable yields [] so the refresh falls back to the old
 * behaviour for that run rather than failing.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseCandidates(raw) {
	if (!raw || !String(raw).trim()) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
	} catch {
		return [];
	}
}
