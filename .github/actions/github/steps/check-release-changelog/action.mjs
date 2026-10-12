/**
 * @fileoverview Release-PR changelog gate. The persistent `next → master` /
 * `hotfixes → master` release PR carries the version's curated changelog as its
 * body and, via the squash, as the release notes. A release PR that merges
 * without the per-version changelog file on its source branch ships generated,
 * commit-dump notes (CLDMV/.github#359). This step fails the check until the
 * file exists.
 *
 * The version is the one the release machinery already computed: it is read
 * from the release PR title (`release: vX.Y.Z …`, written by
 * create/update-release-pr), never recomputed here; package.json is only a
 * fallback when the title carries no version. File discovery reuses
 * `readVersionChangelogFile` from the release-PR body generator, so the check
 * and the generator can never disagree about what counts as "the changelog".
 *
 * `CLDMV_SKIP_CHANGELOG_CHECK=1` keeps the check running but downgrades a miss
 * to a notice and a passing result.
 *
 * @module @cldmv/.github.github.steps.check-release-changelog
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getInput, setOutput } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { readVersionChangelogFile } from "../../../git/steps/generate-comprehensive-changelog/action.mjs";

/**
 * Pull the version out of a release PR title (`release: v1.2.3 - …`).
 *
 * @public
 * @param {string} title - Release PR title.
 * @returns {string} The version without a leading `v`, or "" when absent.
 */
export function versionFromTitle(title) {
	const m = /^release:\s*v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(String(title || "").trim());
	return m ? m[1] : "";
}

/**
 * The preferred (first-choice) repo-relative changelog path, used in the failure
 * message. Mirrors the first non-template candidate of readVersionChangelogFile.
 *
 * @public
 * @param {string} version - Release version.
 * @param {string} dir - Changelog base directory ("" = default).
 * @param {string} fileTemplate - Explicit path template ("" = none).
 * @returns {{ preferred: string, candidates: string[] }}
 */
export function expectedChangelogPaths(version, dir, fileTemplate) {
	const major = version.split(".")[0];
	const subst = (t) => t.replace(/\{version\}/g, version).replace(/\{major\}/g, major);
	const bases = String(dir || "").trim() ? [String(dir).trim().replace(/\/+$/, "")] : ["docs/changelog", "docs/changelogs"];
	const candidates = [];
	if (fileTemplate && fileTemplate.trim()) candidates.push(subst(fileTemplate.trim()));
	for (const base of bases) candidates.push(`${base}/v${major}/v${version}.md`, `${base}/v${version}.md`, `${base}/${version}.md`);
	return { preferred: candidates[0], candidates };
}

/**
 * Advisory: does the README "What's New" block name the version? Looks at the
 * section from a heading containing "What's New" to the next heading of the same
 * or higher level; a README with no such section is not judged.
 *
 * @public
 * @param {string} readme - README contents.
 * @param {string} version - Release version.
 * @returns {"named"|"missing"|"no-section"}
 */
export function whatsNewStatus(readme, version) {
	const lines = String(readme || "").split("\n");
	const start = lines.findIndex((l) => /^#{1,6}\s.*what['’]?s new/i.test(l));
	if (start === -1) return "no-section";
	const level = /^(#+)/.exec(lines[start])[1].length;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const m = /^(#+)\s/.exec(lines[i]);
		if (m && m[1].length <= level) {
			end = i;
			break;
		}
	}
	const block = lines.slice(start, end).join("\n");
	const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`(^|[^0-9.])v?${escaped}(?![0-9]|\\.[0-9])`).test(block) ? "named" : "missing";
}

/**
 * Whether the skip variable is set to an enabling value.
 *
 * @public
 * @param {string} raw - Raw variable value.
 * @returns {boolean}
 */
export function isSkipped(raw) {
	const v = String(raw || "")
		.trim()
		.toLowerCase();
	return v === "1" || v === "true";
}

async function main() {
	const branch = getInput("branch", { required: true });
	const base = getInput("base", { required: true });
	const dir = getInput("changelog-dir");
	const fileTemplate = getInput("changelog-file");
	const skip = isSkipped(getInput("skip"));
	const readmePath = getInput("readme-path", { default: "README.md" });
	const token = getInput("github-token");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);
	const workspace = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

	const prs = await api(
		"GET",
		`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}&base=${encodeURIComponent(base)}&per_page=1`,
		null,
		{ token, owner, repo }
	);
	const pr = Array.isArray(prs) ? prs[0] : null;
	if (!pr) {
		console.log(`ℹ️ No open ${branch} → ${base} release PR — nothing to check.`);
		setOutput("found", "");
		return;
	}

	let version = versionFromTitle(pr.title);
	if (!version) {
		try {
			version = String(JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8")).version || "");
		} catch {
			version = "";
		}
		console.log(`⚠️ Release PR #${pr.number} title carries no version; falling back to package.json: ${version || "(none)"}`);
	}
	if (!version) {
		throw new Error(`Cannot determine the version release PR #${pr.number} ships (no \`release: vX.Y.Z\` title, no package.json version).`);
	}
	setOutput("version", version);

	const { preferred } = expectedChangelogPaths(version, dir, fileTemplate);
	const found = readVersionChangelogFile(version, dir, fileTemplate) !== null;
	setOutput("found", found ? "true" : "false");
	setOutput("path", preferred);

	if (found) {
		console.log(`✅ Changelog for v${version} is present on ${branch}.`);
	} else {
		const { candidates } = expectedChangelogPaths(version, dir, fileTemplate);
		const message =
			`Release PR #${pr.number} ships v${version}, but no changelog for it exists on the \`${branch}\` branch. ` +
			`Expected \`${preferred}\` (also accepted: ${candidates
				.slice(1)
				.map((c) => `\`${c}\``)
				.join(", ")}). ` +
			`Author the release changelog on \`${branch}\` (a docs PR into \`${branch}\`); this check re-runs when \`${branch}\` changes.`;
		if (skip) {
			console.log(`::notice title=Changelog check skipped::CLDMV_SKIP_CHANGELOG_CHECK is set. ${message}`);
		} else {
			console.log(`::error title=Missing release changelog::${message}`);
			process.exitCode = 1;
		}
	}

	// Advisory only: never fails the check.
	const readmeAbs = path.resolve(workspace, readmePath);
	if (existsSync(readmeAbs)) {
		const status = whatsNewStatus(readFileSync(readmeAbs, "utf8"), version);
		if (status === "missing") {
			console.log(`::warning title=README What's New::The What's New block in ${readmePath} does not name v${version}.`);
		}
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
