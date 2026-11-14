/**
 * Release-notes helpers shared by create-release, release/create and the
 * sync-release-notes step.
 *
 * - Locate a committed per-version changelog file at a given commit
 *   (`docs/changelog[s]/v<major>/v<version>.md`, same lookup order the
 *   release-PR opener uses in generate-comprehensive-changelog).
 * - Build a release body from that file, carrying over the coverage and
 *   Contributors blocks from the commit-derived body.
 * - Strip the duplicated `release: vX.Y.Z - …` subject line and the squash
 *   trailers (`Co-authored-by:` …) from commit-derived bodies.
 * - Pin the changelog's relative links to the release tag (`pinRelativeLinks`),
 *   since GitHub resolves a release body against the repo root.
 * - Neutralize accidental `@word` mentions in prose (wrap them in a code span)
 *   while keeping the intended Contributors handles live.
 *
 * Pure functions except `readChangelogAtRef`, which shells out to git.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

const CONTRIBUTORS_RE = /<details>\s*<summary>\s*👥 Contributors\s*<\/summary>[\s\S]*?<\/details>/i;
const COVERAGE_RE = /<!-- coverage-start -->[\s\S]*?<!-- coverage-end -->/;
const TRAILER_RE = /^(co-authored-by|signed-off-by|reviewed-by|helped-by):/i;

/**
 * Normalize line endings and strip a single leading `v`.
 * @param {string} version - Version with or without a leading `v`.
 * @returns {string} Bare version, e.g. `1.2.3`.
 */
export function bareVersion(version) {
	return String(version || "")
		.trim()
		.replace(/^v/i, "");
}

/**
 * Resolve one link target from a changelog file to an absolute GitHub URL.
 * Returns null when the target should stay as written: absolute URLs (any
 * scheme, `//host`), `#anchors`, and paths that climb above the repo root.
 * @param {string} target - Raw link target (no surrounding `<>`).
 * @param {object} opts
 * @param {string} opts.repo - `owner/name`.
 * @param {string} opts.filePath - Repo-relative path of the changelog file.
 * @param {(path: string) => string} opts.refFor - Ref to pin a resolved path to.
 * @param {boolean} opts.image - True for an image source (`raw/` instead of `blob/`).
 * @returns {string|null} Absolute URL, or null to leave the target alone.
 */
function resolveLinkTarget(target, { repo, filePath, refFor, image }) {
	const t = String(target || "").trim();
	if (!t || t.startsWith("#") || t.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
	const cut = t.search(/[?#]/);
	const rawPath = cut === -1 ? t : t.slice(0, cut);
	const suffix = cut === -1 ? "" : t.slice(cut);
	if (!rawPath) return null;
	const baseDir = rawPath.startsWith("/") ? "" : path.posix.dirname(String(filePath || ""));
	const joined = path.posix.normalize(path.posix.join("/", baseDir === "." ? "" : baseDir, rawPath));
	const resolved = joined.replace(/^\/+/, "");
	// path.posix.join("/", …) clamps "..", so detect an escape on the unclamped form.
	const unclamped = path.posix.normalize(path.posix.join(baseDir === "." ? "" : baseDir, rawPath.replace(/^\/+/, "")));
	if (!rawPath.startsWith("/") && (unclamped === ".." || unclamped.startsWith("../"))) return null;
	const ref = refFor(resolved);
	if (!ref) return null;
	const kind = image ? "raw" : "blob";
	const encoded = resolved
		.split("/")
		.map((seg) => encodeURIComponent(decodeSafe(seg)))
		.join("/");
	return `https://github.com/${repo}/${kind}/${encodeURIComponent(ref).replace(/%2F/g, "/")}/${encoded}${suffix}`.replace(/\/$/, "");
}

/**
 * decodeURIComponent that returns its input on malformed escapes.
 * @param {string} s - Possibly percent-encoded text.
 * @returns {string} Decoded text.
 */
function decodeSafe(s) {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/**
 * Rewrite the relative links and images of a changelog file into absolute
 * GitHub URLs pinned to a ref (normally the release tag), so they work where
 * GitHub renders the text against something other than the file's own folder:
 * the Release page (resolved against the repo root) and the release PR body
 * (resolved against the PR URL).
 *
 * Covers inline links and images (`[t](x)`, `![a](x)`), reference definitions
 * (`[id]: x`) and HTML `href`/`src` attributes. Images become `raw/` URLs,
 * everything else `blob/`. Left alone: absolute URLs, `//host`, `#anchors`,
 * `mailto:` and other schemes, fenced code blocks, inline code spans, and
 * paths that climb above the repository root. Idempotent: rewritten links are
 * absolute and skipped next time.
 *
 * @param {string} markdown - Changelog content.
 * @param {object} opts
 * @param {string} opts.repo - `owner/name`; missing → content returned unchanged.
 * @param {string} opts.filePath - Repo-relative path the content was read from.
 * @param {string|((path: string) => string)} opts.ref - Ref (e.g. `v1.2.3`) or a function picking one per resolved path.
 * @returns {string} Content with relative links pinned.
 */
export function pinRelativeLinks(markdown, { repo = "", filePath = "", ref = "" } = {}) {
	if (!markdown || !/^[\w.-]+\/[\w.-]+$/.test(String(repo)) || !filePath || !ref) return markdown || "";
	const refFor = typeof ref === "function" ? ref : () => ref;
	const opts = (image) => ({ repo, filePath, refFor, image });
	const inline = (text) =>
		text
			// Inline links and images: [text](target "title") / ![alt](<target>)
			.replace(
				/(!?)\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^<>\n]*>|[^\s()<>]+)((?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*)\)/g,
				(m, bang, label, rawTarget, title) => {
					const angled = rawTarget.startsWith("<");
					const target = angled ? rawTarget.slice(1, -1) : rawTarget;
					const url = resolveLinkTarget(target, opts(bang === "!"));
					return url ? `${bang}[${label}](${url}${title})` : m;
				}
			)
			// HTML attributes: <a href="x">, <img src="x">
			.replace(/(<(img|source)\b[^>]*?\s(?:src|srcset)=|<a\b[^>]*?\shref=)(["'])([^"'\n]*)\3/gi, (m, head, tag, q, target) => {
				const url = resolveLinkTarget(target, opts(Boolean(tag)));
				return url ? `${head}${q}${url}${q}` : m;
			});
	let fence = null;
	return String(markdown)
		.replace(/\r\n/g, "\n")
		.split("\n")
		.map((line) => {
			const fm = line.match(/^\s{0,3}(`{3,}|~{3,})/);
			if (fence) {
				if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.trim() === fm[1]) fence = null;
				return line;
			}
			if (fm) {
				fence = fm[1];
				return line;
			}
			// Reference definition: [id]: target "title"
			const def = line.match(/^(\s{0,3}\[[^\]\n]+\]:\s*)(<[^<>\n]*>|\S+)(.*)$/);
			if (def) {
				const angled = def[2].startsWith("<");
				const url = resolveLinkTarget(angled ? def[2].slice(1, -1) : def[2], opts(false));
				return url ? `${def[1]}${url}${def[3]}` : line;
			}
			// Leave inline code spans untouched: rewrite only the text between them.
			return line
				.split(/(`+[^`]*?`+)/)
				.map((part, i) => (i % 2 ? part : inline(part)))
				.join("");
		})
		.join("\n");
}

/**
 * Move this repository's `blob/<from>/…`, `raw/<from>/…` and `tree/<from>/…`
 * links to `<to>`. The open release PR body pins a changelog's relative links
 * to its head branch (`next`/`hotfixes`) so they work during review; once the
 * release is tagged, this turns them into tag links for the squash commit and
 * the merged PR. Links to other repositories and other refs are untouched, and
 * a body that already carries tag links is returned unchanged.
 * @param {string} markdown - Body text.
 * @param {object} opts
 * @param {string} opts.repo - `owner/name`.
 * @param {string} opts.from - Branch the links currently point at.
 * @param {string} opts.to - Ref to point them at (normally the release tag).
 * @returns {string} Body with the branch links moved.
 */
export function repinBranchLinks(markdown, { repo = "", from = "", to = "" } = {}) {
	if (!markdown || !/^[\w.-]+\/[\w.-]+$/.test(String(repo)) || !from || !to || from === to) return markdown || "";
	const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const enc = (s) => encodeURIComponent(s).replace(/%2F/g, "/");
	const re = new RegExp(`(https://github\\.com/${esc(repo)}/(?:blob|raw|tree)/)${esc(enc(from))}(?=[/?#)\\s"'>]|$)`, "gi");
	return String(markdown).replace(re, (_m, head) => `${head}${enc(to)}`);
}

/**
 * Release PR candidates for a release commit, from `GET /commits/{sha}/pulls`:
 * PRs merged into the default branch whose `merge_commit_sha` is the release
 * commit, or is missing from the listing (it can be; the caller then confirms
 * on the full PR). Exact matches come first.
 * @param {object[]} prs - Listed pull requests.
 * @param {object} opts
 * @param {string} opts.defaultBranch - Release branch name.
 * @param {string} opts.releaseCommit - Release commit SHA.
 * @returns {object[]} Candidates, best first.
 */
export function releasePrCandidates(prs, { defaultBranch = "", releaseCommit = "" } = {}) {
	const merged = (Array.isArray(prs) ? prs : []).filter((p) => p && p.merged_at && p.base?.ref === defaultBranch);
	const exact = merged.filter((p) => p.merge_commit_sha === releaseCommit);
	const unknown = merged.filter((p) => !p.merge_commit_sha);
	return [...exact, ...unknown];
}

/**
 * Release version named by a release PR or commit title (`release: v1.2.3 - …`).
 * @param {string} title - PR title or commit subject.
 * @returns {string} Bare version, or "" when the title names none.
 */
export function releaseTitleVersion(title) {
	const m = String(title || "").match(/^release:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\s|$)/i);
	return m ? m[1] : "";
}

/**
 * Candidate changelog paths for a version, first hit wins. Mirrors the
 * release-PR opener (generate-comprehensive-changelog readVersionChangelogFile)
 * so a file that became the release-PR body is also found here.
 * @param {string} version - Release version.
 * @returns {string[]} Repo-relative candidate paths.
 */
export function changelogCandidates(version) {
	const v = bareVersion(version);
	if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(v)) return [];
	const major = v.split(".")[0];
	const out = [];
	for (const base of ["docs/changelog", "docs/changelogs"]) {
		out.push(`${base}/v${major}/v${v}.md`, `${base}/v${v}.md`, `${base}/${v}.md`);
	}
	return out;
}

/**
 * Read the committed changelog file for `version` as it exists at `ref`.
 * Uses `git show <ref>:<path>` so it works for any commit in a full-history
 * checkout (a release tag, a release commit, or the default-branch tip where a
 * changelog was backfilled later).
 * @param {string} version - Release version.
 * @param {string} ref - Commit-ish to read from.
 * @param {string} [cwd] - Repository working directory.
 * @returns {{path: string, content: string}|null} The first non-empty match, or null.
 */
export function readChangelogAtRef(version, ref, cwd = process.cwd()) {
	if (!ref || !/^[\w./@^~-]+$/.test(ref)) return null;
	for (const rel of changelogCandidates(version)) {
		const res = spawnSync("git", ["show", `${ref}:${rel}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		if (res.status === 0) {
			const content = String(res.stdout || "").trim();
			if (content) return { path: rel, content };
		}
	}
	return null;
}

/**
 * Remove a leading line that just repeats the release title: the release name
 * itself (`v1.2.3`) or the squash subject (`release: v1.2.3 - …`).
 * @param {string} body - Release body.
 * @param {{name?: string, version?: string}} [opts] - Release name / version.
 * @returns {string} Body without the duplicated subject line.
 */
export function stripReleaseSubject(body, { name = "", version = "" } = {}) {
	if (!body) return "";
	const lines = String(body).replace(/\r\n/g, "\n").split("\n");
	const idx = lines.findIndex((l) => l.trim().length > 0);
	if (idx === -1) return lines.join("\n");
	const first = lines[idx].trim();
	const v = bareVersion(version);
	const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const isTitle =
		(name && first.toLowerCase() === String(name).trim().toLowerCase()) ||
		(v && new RegExp(`^release:\\s*v?${escaped}(\\b|\\s|$)`, "i").test(first)) ||
		/^release:\s*v?\d+\.\d+\.\d+/i.test(first);
	if (!isTitle) return lines.join("\n");
	lines.splice(idx, 1);
	while (lines.length > idx && lines[idx].trim() === "") lines.splice(idx, 1);
	return lines.join("\n");
}

/**
 * Drop the git trailer tail a squash merge appends (`---------` separator,
 * `Co-authored-by:` lines). Only the trailing run is removed; a `---` rule in
 * the middle of the body is untouched.
 * @param {string} body - Release body.
 * @returns {string} Body without trailing trailers.
 */
export function stripCommitTrailers(body) {
	if (!body) return "";
	const lines = String(body).replace(/\r\n/g, "\n").split("\n");
	while (lines.length > 0) {
		const t = lines[lines.length - 1].trim();
		if (t === "" || TRAILER_RE.test(t) || /^-{5,}$/.test(t)) lines.pop();
		else break;
	}
	return lines.join("\n");
}

/**
 * @param {string} body - Release body.
 * @returns {string} The `<details>👥 Contributors…</details>` block, or "".
 */
export function extractContributorsBlock(body) {
	const m = String(body || "").match(CONTRIBUTORS_RE);
	return m ? m[0] : "";
}

/**
 * @param {string} body - Release body.
 * @returns {string} The `<!-- coverage-start -->…<!-- coverage-end -->` block, or "".
 */
export function extractCoverageBlock(body) {
	const m = String(body || "").match(COVERAGE_RE);
	return m ? m[0] : "";
}

/**
 * Handles listed in the Contributors block — the only mentions a generated
 * release body intends to make.
 * @param {string} body - Release body.
 * @returns {Set<string>} Lower-cased GitHub logins.
 */
export function contributorHandles(body) {
	const handles = new Set();
	const block = extractContributorsBlock(body);
	for (const m of block.matchAll(/@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g)) handles.add(m[1].toLowerCase());
	return handles;
}

/**
 * Wrap accidental `@word` / `@org/team` mentions in a code span so GitHub
 * neither pings the account nor adds it to the release's Contributors avatars.
 * Leaves alone: handles in `allowed` (the Contributors list), anything inside
 * fenced code blocks, inline code spans, HTML comments, link targets, URLs and
 * e-mail addresses. Idempotent: a wrapped mention is a code span next time.
 * @param {string} body - Markdown body.
 * @param {Iterable<string>} [allowed] - Logins that may stay live mentions.
 * @returns {string} Body with prose mentions neutralized.
 */
export function neutralizeMentions(body, allowed = []) {
	if (!body) return "";
	const allow = new Set([...allowed].map((h) => String(h).toLowerCase()));
	// The release-PR generator neutralizes JSDoc tags with a zero-width space
	// after the `@`; turn those back into plain text first so they get the
	// code-span treatment instead of carrying an invisible character.
	const lines = String(body)
		.replace(/\r\n/g, "\n")
		.replace(/@\u200b/g, "@")
		.split("\n");
	let fence = null;
	let inComment = false;
	const token =
		/(`+)[^`]*?\1|<!--.*?-->|\]\([^)]*\)|<[^<>\s]+>|https?:\/\/[^\s)<>]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\/[A-Za-z0-9._-]+)?/g;
	return lines
		.map((line) => {
			const fm = line.match(/^\s{0,3}(`{3,}|~{3,})/);
			if (fence) {
				if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.trim() === fm[1]) fence = null;
				return line;
			}
			if (fm) {
				fence = fm[1];
				return line;
			}
			if (inComment) {
				if (line.includes("-->")) inComment = false;
				return line;
			}
			if (line.includes("<!--") && !line.slice(line.lastIndexOf("<!--")).includes("-->")) {
				inComment = true;
			}
			return line.replace(token, (match, _ticks, offset, whole) => {
				if (match[0] !== "@") return match;
				const prev = offset > 0 ? whole[offset - 1] : "";
				if (prev && /[\w`/.@-]/.test(prev)) return match;
				const handle = match.slice(1);
				if (!handle.includes("/") && allow.has(handle.toLowerCase())) return match;
				return `\`${match}\``;
			});
		})
		.join("\n");
}

/**
 * Build the release body.
 * - With a changelog file: the file, plus the coverage and Contributors blocks
 *   from the commit-derived body when the file doesn't carry them itself.
 * - Without one: the commit-derived body minus the duplicated subject line and
 *   the squash trailers.
 * Mentions are neutralized either way, keeping the Contributors handles live.
 * @param {object} opts
 * @param {string} [opts.changelog] - Changelog file content (may be empty).
 * @param {string} [opts.baseBody] - Commit-derived / existing body.
 * @param {string} [opts.name] - Release name (e.g. `v1.2.3`).
 * @param {string} [opts.version] - Release version.
 * @param {string} [opts.repo] - `owner/name`, for pinning the changelog's relative links.
 * @param {string} [opts.changelogPath] - Repo-relative path the changelog was read from.
 * @param {string|((path: string) => string)} [opts.linkRef] - Ref the links are pinned to (default: `name`).
 * @returns {string} Final body.
 */
export function buildReleaseBody({
	changelog = "",
	baseBody = "",
	name = "",
	version = "",
	repo = "",
	changelogPath = "",
	linkRef = ""
} = {}) {
	const base = stripCommitTrailers(stripReleaseSubject(baseBody, { name, version })).trim();
	let out;
	if (changelog && changelog.trim()) {
		out = stripReleaseSubject(changelog, { name, version }).trim();
		out = pinRelativeLinks(out, { repo, filePath: changelogPath, ref: linkRef || name });
		const coverage = extractCoverageBlock(base);
		if (coverage && !extractCoverageBlock(out)) out += `\n\n---\n\n${coverage}`;
		const contributors = extractContributorsBlock(base);
		if (contributors && !extractContributorsBlock(out)) out += `\n\n${contributors}`;
	} else {
		out = base;
	}
	return neutralizeMentions(out, contributorHandles(out));
}

/**
 * Compare two bodies ignoring line-ending and surrounding-whitespace noise.
 * @param {string} a - First body.
 * @param {string} b - Second body.
 * @returns {boolean} True when equivalent.
 */
export function sameBody(a, b) {
	const n = (s) =>
		String(s || "")
			.replace(/\r\n/g, "\n")
			.replace(/[ \t]+$/gm, "")
			.trim();
	return n(a) === n(b);
}

/**
 * Make arbitrary text safe for one cell of a markdown table: backslashes are
 * escaped first (so an input `\|` can't turn into an unescaped pipe), then
 * the pipe that would end the cell, and line breaks collapse to a space.
 * @param {unknown} value - Cell text (git output, API error text, …).
 * @returns {string} Escaped single-line cell content.
 */
export function escapeTableCell(value) {
	return String(value ?? "")
		.replace(/\\/g, "\\\\")
		.replace(/\|/g, "\\|")
		.replace(/[\r\n]+/g, " ");
}
