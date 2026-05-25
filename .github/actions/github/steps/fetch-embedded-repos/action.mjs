/**
 * @fileoverview Detect anonymous gitlinks in the parent's HEAD and clone each
 * embedded private repo into its expected directory. Two conventions are
 * supported (auto-detected per the design in docs/conventions/embedded-tests-ci.md):
 *
 *   1. Per-path:      each gitlink path → <org>/<repo>-<dashed-path>
 *   2. Consolidated:  all gitlinks → subdirs of <org>/<repo>-embedded
 *
 * Selection: probe for <org>/<repo>-embedded; if accessible, use consolidated
 * for all gitlinks. Otherwise use per-path. If both per-path repos AND
 * <repo>-embedded exist, prefer consolidated and warn.
 *
 * @module @cldmv/.github.actions.github.steps.fetch-embedded-repos
 */

import { sh, exec, getInput, setOutput, appendSummary, debugLog } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { mkdtempSync, rmSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

const token = getInput("token");
const debug = getInput("debug") === "true";

// ──────────────────────────────────────────────────────────────────────
// Step 1 — short-circuit on missing token (the fork-PR case).
// ──────────────────────────────────────────────────────────────────────
if (!token) {
	console.log("::notice::No bot App token available; skipping embedded-repo fetch (typical for fork-PR runs without secrets)");
	setOutput("skipped_reason", "no-secrets");
	setOutput("fetched_paths", "");
	setOutput("convention", "");
	appendSummary("### 📦 Embedded private repos\n\n**Skipped:** no bot App token available (typical for fork PRs).\n");
	process.exit(0);
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — detect gitlinks in the parent's HEAD.
// ──────────────────────────────────────────────────────────────────────
// `git ls-tree -r HEAD` enumerates every tree entry. Lines with type 'commit'
// (mode 160000) are gitlinks. The output format is:
//   <mode> SP <type> SP <sha> TAB <path>
const lsTree = sh("git ls-tree -r HEAD");
const gitlinks = lsTree
	.split("\n")
	.map((line) => {
		const m = line.match(/^(\d+)\s+(\w+)\s+([a-f0-9]+)\t(.+)$/);
		if (!m) return null;
		const [, , type, sha, path] = m;
		return type === "commit" ? { sha, path } : null;
	})
	.filter(Boolean);

if (gitlinks.length === 0) {
	console.log("::notice::No embedded gitlinks found in HEAD; nothing to fetch");
	setOutput("skipped_reason", "no-gitlinks");
	setOutput("fetched_paths", "");
	setOutput("convention", "");
	appendSummary("### 📦 Embedded private repos\n\n**Skipped:** no embedded gitlinks found in HEAD.\n");
	process.exit(0);
}

console.log(`::notice::Found ${gitlinks.length} embedded gitlink(s) to fetch`);
if (debug) {
	for (const { sha, path } of gitlinks) {
		console.log(`  ${sha} → ${path}`);
	}
}

// ──────────────────────────────────────────────────────────────────────
// Step 3 — determine convention by probing <org>/<repo>-embedded.
// ──────────────────────────────────────────────────────────────────────
const { owner, repo: parentName } = parseRepo(process.env.GITHUB_REPOSITORY);
const embeddedRepoName = `${parentName}-embedded`;

let convention;
let embeddedRepoExists = false;
try {
	await api("GET", "", null, { token, owner, repo: embeddedRepoName });
	embeddedRepoExists = true;
} catch (e) {
	// Repo doesn't exist or isn't accessible to the App — fall back to per-path.
	debugLog(`Probe for ${owner}/${embeddedRepoName} returned non-OK; assuming per-path convention.`, e.message);
}

if (embeddedRepoExists) {
	convention = "consolidated";
	console.log(`::notice::Using consolidated convention: ${owner}/${embeddedRepoName}`);

	// Detect per-path conflicts (warn if both exist for any gitlink).
	const conflicts = [];
	for (const { path } of gitlinks) {
		const suffix = pathToSuffix(path);
		const perPathRepo = `${parentName}-${suffix}`;
		try {
			await api("GET", "", null, { token, owner, repo: perPathRepo });
			conflicts.push(`${owner}/${perPathRepo}`);
		} catch {
			// Doesn't exist or not accessible — no conflict.
		}
	}
	if (conflicts.length > 0) {
		console.log(`::warning::Both '${owner}/${embeddedRepoName}' AND per-path repos exist; using consolidated.`);
		for (const c of conflicts) {
			console.log(`  - ${c}`);
		}
		console.log("Consider removing the per-path repos to make the convention choice unambiguous.");
	}
} else {
	convention = "per-path";
	console.log("::notice::Using per-path convention (one private repo per gitlink)");
}
setOutput("convention", convention);

// ──────────────────────────────────────────────────────────────────────
// Step 4 — fetch each embedded repo.
// ──────────────────────────────────────────────────────────────────────
// Partial success is NOT acceptable — any failure exits the action with
// the partial fetched_paths recorded for diagnosis.
const fetched = [];

try {
	if (convention === "consolidated") {
		await fetchConsolidated();
	} else {
		await fetchPerPath();
	}
} catch (e) {
	console.log(`::error::${e.message}`);
	setOutput("fetched_paths", fetched.join("\n"));
	process.exit(1);
}

setOutput("fetched_paths", fetched.join("\n"));

// ──────────────────────────────────────────────────────────────────────
// Step 5 — summary to $GITHUB_STEP_SUMMARY.
// ──────────────────────────────────────────────────────────────────────
const lines = ["### 📦 Embedded private repos", "", `**Convention:** \`${convention}\``, "", "**Fetched:**"];
for (const p of fetched) {
	lines.push(`- \`${p}\``);
}
appendSummary(lines.join("\n") + "\n");

// ──────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────

function pathToSuffix(p) {
	return p.replace(/\/$/, "").replace(/\//g, "-");
}

function tokenUrl(repoFullName) {
	return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
}

async function fetchConsolidated() {
	const embeddedRepo = `${owner}/${embeddedRepoName}`;
	const tmpDir = mkdtempSync(join(tmpdir(), "git-embedded-"));

	try {
		try {
			exec(`git clone --quiet "${tokenUrl(embeddedRepo)}" "${tmpDir}"`);
		} catch {
			throw new Error(`Failed to clone ${embeddedRepo} (check that the bot App is installed on this repo)`);
		}

		for (const { sha, path } of gitlinks) {
			const cleanPath = path.replace(/\/$/, "");

			// Pin the tmp clone to this gitlink's SHA. Each gitlink in the
			// parent can pin a different SHA of -embedded; the tmp gets
			// re-pinned per gitlink before extracting its subdir.
			try {
				exec(`git -C "${tmpDir}" checkout --quiet --detach ${sha}`);
			} catch {
				throw new Error(`SHA ${sha} not found on ${embeddedRepo}; push the missing commit for path '${path}'`);
			}

			const src = join(tmpDir, cleanPath);
			if (!existsSync(src)) {
				throw new Error(`Path '${path}' not found in ${embeddedRepo}@${sha} (expected directory at ${src})`);
			}

			// Stage into parent's working tree at the gitlink path.
			const parent = dirname(cleanPath);
			if (parent && parent !== ".") {
				mkdirSync(parent, { recursive: true });
			}
			rmSync(cleanPath, { recursive: true, force: true });
			cpSync(src, cleanPath, { recursive: true });

			fetched.push(cleanPath);
			console.log(`  ✓ ${cleanPath}  ←  ${embeddedRepo}@${sha.slice(0, 8)}/${cleanPath}`);
		}
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

async function fetchPerPath() {
	for (const { sha, path } of gitlinks) {
		const cleanPath = path.replace(/\/$/, "");
		const suffix = pathToSuffix(path);
		const repoFullName = `${owner}/${parentName}-${suffix}`;

		try {
			exec(`git clone --no-checkout --quiet "${tokenUrl(repoFullName)}" "${cleanPath}"`);
		} catch {
			throw new Error(`Failed to clone ${repoFullName} for gitlink '${path}' (check bot App installation and that the repo exists)`);
		}

		try {
			exec(`git -C "${cleanPath}" checkout --quiet --detach ${sha}`);
		} catch {
			throw new Error(`SHA ${sha} not found on ${repoFullName}; push the missing commit`);
		}

		// Verify the checkout landed at the expected SHA.
		const actual = sh(`git -C "${cleanPath}" rev-parse HEAD`);
		if (actual !== sha) {
			throw new Error(`${repoFullName} checkout landed at ${actual}, expected ${sha}`);
		}

		fetched.push(cleanPath);
		console.log(`  ✓ ${cleanPath}  ←  ${repoFullName}@${sha.slice(0, 8)}`);
	}
}
