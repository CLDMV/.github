#!/usr/bin/env node

/**
 * Sync release notes from committed changelog files
 *
 * Walks every released version of the current repository — version tags
 * (`vX.Y.Z`), GitHub Releases, and `release: vX.Y.Z …` commits on the default
 * branch — and, for each version whose per-version changelog file exists
 * (`docs/changelog[s]/v<major>/v<version>.md`, read at the default-branch tip,
 * which carries later corrections and backfills, else at the release tag/commit), rewrites the release
 * body from that file. The Contributors and coverage blocks already on the
 * release are kept, the duplicated `release: vX.Y.Z - …` subject line is
 * dropped, and accidental `@word` mentions in prose are neutralized.
 *
 * Repairs are opt-in: missing tags, missing releases and draft releases are
 * only reported unless `create-missing-tags`, `create-missing-releases` or
 * `publish-drafts` is set. `dry-run` (default true) changes nothing.
 *
 * Needs a full-history checkout of the repository (fetch-depth: 0, tags).
 */

import { execFileSync } from "node:child_process";
import { getInput, getBooleanInput, setOutputs, appendSummary } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { run as createTag } from "../../api/tag/create/_impl.mjs";
import {
	buildReleaseBody,
	escapeTableCell,
	readChangelogAtRef,
	sameBody,
	stripCommitTrailers,
	stripReleaseSubject
} from "../../utilities/release-notes.mjs";

const token = getInput("github-token", { required: true });
const repoFull = process.env.GITHUB_REPOSITORY || "";
const { owner, repo } = parseRepo(repoFull);
const ctx = { token, owner, repo };
const dryRun = getBooleanInput("dry-run", true);
const createTags = getBooleanInput("create-missing-tags", false);
const createReleases = getBooleanInput("create-missing-releases", false);
const publishDrafts = getBooleanInput("publish-drafts", false);
const normalizeAll = getBooleanInput("normalize-all", false);
// Batch cap on tags created in one run: a backlog (e.g. eight untagged release
// commits) is fine, a runaway isn't. The rest are reported and picked up by the
// next run.
const maxNewTags = Math.max(0, Number.parseInt(getInput("max-new-tags", { default: "20" }), 10) || 0);
let tagsCreated = 0;
const versionFilter = getInput("versions")
	.split(/[\s,]+/)
	.map((v) => v.trim().replace(/^v/i, ""))
	.filter(Boolean);
const gpg = {
	gpg_enabled: getBooleanInput("gpg_enabled", false) || !!getInput("gpg_private_key"),
	tagger_name: getInput("tagger_name"),
	tagger_email: getInput("tagger_email"),
	gpg_private_key: getInput("gpg_private_key"),
	gpg_passphrase: getInput("gpg_passphrase")
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * @param {string[]} args - git arguments.
 * @returns {string} Trimmed stdout ("" on failure).
 */
function git(args) {
	try {
		return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim();
	} catch {
		return "";
	}
}

/**
 * Semver comparison (prerelease < release; prerelease ids compared as strings).
 * @param {string} a - Version.
 * @param {string} b - Version.
 * @returns {number} Sort order.
 */
function cmpVersion(a, b) {
	const pa = a.match(SEMVER) || [];
	const pb = b.match(SEMVER) || [];
	for (let i = 1; i <= 3; i++) {
		const d = Number(pa[i] || 0) - Number(pb[i] || 0);
		if (d) return d;
	}
	if (pa[4] && !pb[4]) return -1;
	if (!pa[4] && pb[4]) return 1;
	return String(pa[4] || "").localeCompare(String(pb[4] || ""));
}

const repoInfo = await api("GET", "", null, ctx);
const defaultBranch = repoInfo.default_branch || "master";
git(["fetch", "--force", "--tags", "origin", `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`]);
const tip = `origin/${defaultBranch}`;

// Version tags → commit.
const tags = new Map();
for (const name of git(["tag", "-l", "v*"]).split("\n").filter(Boolean)) {
	const v = name.replace(/^v/, "");
	if (!SEMVER.test(v)) continue;
	const sha = git(["rev-list", "-n", "1", `refs/tags/${name}`]);
	if (sha) tags.set(v, sha);
}

// Release commits on the default branch (newest first; first hit per version wins).
const releaseCommits = new Map();
for (const rec of git(["log", tip, "--format=%H%x1f%s%x1e"]).split("\x1e")) {
	const [sha, subject] = rec.trim().split("\x1f");
	const m = (subject || "").match(/^release:\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/i);
	if (sha && m && !releaseCommits.has(m[1])) releaseCommits.set(m[1], sha);
}

// GitHub Releases (drafts included — the token has push access).
const releases = [];
for (let page = 1; page <= 20; page++) {
	const items = await api("GET", `/releases?per_page=100&page=${page}`, null, ctx);
	releases.push(...(items || []));
	if (!items || items.length < 100) break;
}

const versions = new Set([...tags.keys(), ...releaseCommits.keys()]);
for (const r of releases) {
	const v = String(r.tag_name || "").replace(/^v/, "");
	if (SEMVER.test(v) && String(r.tag_name).startsWith("v")) versions.add(v);
}

const rows = [];
let changed = 0;
let problems = 0;
let failures = 0;

for (const version of [...versions].sort(cmpVersion)) {
	if (versionFilter.length && !versionFilter.includes(version)) continue;
	const tagName = `v${version}`;
	const row = { version, tag: "", release: "", changelog: "", actions: [], issues: [], failures: [] };
	let tagSha = tags.get(version) || "";
	const relCommit = releaseCommits.get(version) || "";
	const rels = releases.filter((r) => r.tag_name === tagName);
	const primary = rels.find((r) => !r.draft) || [...rels].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
	if (rels.length > 1) {
		row.issues.push(
			`${rels.length} releases share ${tagName} (ids ${rels.map((r) => `${r.id}${r.draft ? " draft" : ""}`).join(", ")}) — delete the extras by hand`
		);
	}

	// Prefer the file as it reads on the default branch now — it carries later
	// corrections and backfills — and fall back to the copy at the release.
	const ref = tagSha || relCommit;
	const file = readChangelogAtRef(version, tip) || (ref && readChangelogAtRef(version, ref));
	row.changelog = file ? file.path : "";

	// Tag
	if (tagSha) {
		row.tag = relCommit && relCommit !== tagSha ? `⚠️ ${tagSha.slice(0, 7)} (release commit ${relCommit.slice(0, 7)})` : tagSha.slice(0, 7);
	} else if (!relCommit) {
		row.tag = "missing";
		row.issues.push("no tag and no release commit on the default branch");
	} else if (createTags && !dryRun && !gpg.gpg_private_key) {
		// Release tags must be bot-signed; never create an unsigned one.
		row.tag = `missing (release commit ${relCommit.slice(0, 7)})`;
		row.failures.push("tag not created: no bot GPG key provided (release tags must be signed)");
	} else if (createTags && !dryRun && tagsCreated >= maxNewTags) {
		row.tag = `missing (release commit ${relCommit.slice(0, 7)})`;
		row.issues.push(`tag not created: per-run cap of ${maxNewTags} reached — the next run continues`);
	} else if (createTags && !dryRun) {
		try {
			// Signed tag at the release commit; the message is the changelog file
			// (else the release commit message), kept verbatim incl. headings.
			const commitMsg = git(["log", "-1", "--format=%B", relCommit]);
			const tagMessage = file?.content || stripCommitTrailers(stripReleaseSubject(commitMsg, { name: tagName, version })).trim() || tagName;
			tagsCreated++;
			await createTag({ token, repo: repoFull, tag: tagName, sha: relCommit, message: tagMessage, push: true, ...gpg });
			tagSha = relCommit;
			row.tag = `created at ${relCommit.slice(0, 7)}`;
			row.actions.push("created tag");
			changed++;
			// tag/create has no unsigned fallback; assert the pushed tag is signed anyway.
			git(["fetch", "--force", "origin", `+refs/tags/${tagName}:refs/tags/${tagName}`]);
			if (!/BEGIN (PGP|SSH) SIGNATURE/.test(git(["cat-file", "-p", `refs/tags/${tagName}`]))) {
				row.failures.push(`tag ${tagName} on the remote is not signed — investigate`);
			}
		} catch (e) {
			row.tag = "missing";
			row.failures.push(`tag creation failed: ${e.message}`);
		}
	} else {
		row.tag = `missing (release commit ${relCommit.slice(0, 7)})`;
		if (createTags) row.actions.push("would create tag");
		else row.issues.push("tag missing");
	}

	// Release
	if (!primary) {
		row.release = "missing";
		if (!tagSha) {
			// Nothing to attach a release to.
		} else if (createReleases) {
			const base = git(["log", "-1", "--format=%B", relCommit || tagSha]);
			const body = buildReleaseBody({ changelog: file?.content || "", baseBody: base, name: tagName, version });
			if (dryRun) {
				row.actions.push("would create release");
			} else {
				try {
					const created = await api(
						"POST",
						"/releases",
						{ tag_name: tagName, name: tagName, body, draft: false, make_latest: "legacy" },
						ctx
					);
					row.release = `created ${created.html_url}`;
					row.actions.push("created release");
					changed++;
				} catch (e) {
					row.failures.push(`release creation failed: ${e.message}`);
				}
			}
		} else {
			row.issues.push("release missing");
		}
	} else {
		row.release = primary.draft ? "draft" : "published";
		const patch = {};
		if (file || normalizeAll) {
			const desired = buildReleaseBody({
				changelog: file?.content || "",
				baseBody: primary.body || "",
				name: primary.name || tagName,
				version
			});
			if (!sameBody(desired, primary.body)) patch.body = desired;
		}
		if (primary.draft) {
			if (publishDrafts && tagSha) patch.draft = false;
			else row.issues.push(tagSha ? "release is a draft" : "release is a draft and its tag is missing");
		}
		if (Object.keys(patch).length) {
			const what = [patch.body !== undefined ? "body" : "", patch.draft === false ? "publish" : ""].filter(Boolean).join(" + ");
			if (dryRun) {
				row.actions.push(`would update ${what}`);
			} else {
				try {
					const updated = await api("PATCH", `/releases/${primary.id}`, patch, ctx);
					row.release = updated.draft ? "draft" : "published";
					row.actions.push(`updated ${what}`);
					changed++;
					if (patch.draft === false && updated.draft) row.failures.push("still a draft after publishing");
				} catch (e) {
					row.failures.push(`update failed: ${e.message}`);
				}
			}
		}
	}

	problems += row.issues.length;
	failures += row.failures.length;
	rows.push(row);
}

const esc = escapeTableCell;
let md = `## 📝 Release notes sync — ${repoFull}${dryRun ? " (dry run)" : ""}\n\n`;
md += "| Version | Tag | Release | Changelog | Actions | Problems |\n|---|---|---|---|---|---|\n";
for (const r of rows) {
	md += `| ${r.version} | ${esc(r.tag)} | ${esc(r.release)} | ${esc(r.changelog || "—")} | ${esc(r.actions.join("; ") || "—")} | ${esc([...r.failures.map((f) => `❌ ${f}`), ...r.issues].join("; ") || "—")} |\n`;
}
const planned = rows.reduce((n, r) => n + r.actions.filter((a) => a.startsWith("would ")).length, 0);
if (changed === 0 && planned === 0 && failures === 0) {
	md += "\n✅ Nothing to change — every release already matches its changelog file.\n";
} else if (dryRun) {
	md += `\n${planned} change(s) would be made (dry run).\n`;
} else {
	md += `\n${changed} change(s) applied.\n`;
}
if (problems > 0)
	md += `\n${problems} item(s) need a manual decision (see Problems; the dispatch switches can repair missing tags/releases).\n`;
if (failures > 0) md += `\n❌ ${failures} attempted repair(s) failed.\n`;
console.log(md);
appendSummary(md);
setOutputs({ "changed-count": String(changed), "problems-count": String(problems), "failures-count": String(failures) });

// Fail only when something this run attempted did not work. Pre-existing drift
// that needs a decision (old tags with no release, release commits with no tag)
// is reported as a warning, so the automatic runs don't stay red forever.
if (problems > 0) console.warn(`::warning::${problems} release/tag item(s) need a manual decision — see the job summary.`);
if (failures > 0) {
	for (const r of rows) for (const f of r.failures) console.error(`::error::v${r.version}: ${f}`);
	console.error(`::error::${failures} attempted repair(s) failed — see the job summary.`);
	process.exitCode = 1;
}
