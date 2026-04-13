/**
 *	@Project: sync-org-labels
 *	@Filename: /sync.mjs
 *	@Description: Syncs GitHub labels across every repo in the org using
 *	              data/github-labels.json as the source of truth.
 *
 *	              For each repo:
 *	                - Skip if .labelignore exists at the repo root
 *	                - Rename labels that match an alias to their canonical name
 *	                - Update color/description if they differ
 *	                - Delete labels with no match in the JSON
 *	                - Create missing canonical labels
 *	              Writes a full per-repo report to $GITHUB_STEP_SUMMARY.
 */

import { appendFileSync, readFileSync } from "fs";

// ─── Config ───────────────────────────────────────────────────────────────────

const TOKEN = process.env.GITHUB_TOKEN;
const ORG = process.env.ORG;
const DRY_RUN = process.env.DRY_RUN === "true";
const DEBUG = process.env.DEBUG === "true";
const LABELS_JSON_PATH = process.env.LABELS_JSON_PATH;
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY;

if (!TOKEN) throw new Error("GITHUB_TOKEN is not set");
if (!ORG) throw new Error("ORG is not set");
if (!LABELS_JSON_PATH) throw new Error("LABELS_JSON_PATH is not set");

// ─── GitHub API helpers ────────────────────────────────────────────────────────

const BASE = "https://api.github.com";

/**
 * Standard headers for GitHub API requests.
 * @returns {Record<string, string>}
 */
function authHeaders() {
	return {
		Authorization: `Bearer ${TOKEN}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2026-03-10"
	};
}

/**
 * Validates the token by checking rate-limit, app identity, repo
 * permissions, and — most importantly — whether label writes are
 * actually allowed.  Logs diagnostics so we can tell at a glance
 * whether the token is an app installation token and what
 * permissions the installation was granted.
 */
async function validateToken() {
	console.log("::group::🔑 Token diagnostics");

	// ── 1. Rate-limit check ─────────────────────────────────────────────
	//    App installation tokens get 5 000 req/h; GITHUB_TOKEN gets 1 000.
	//    The `rate` object was removed in 2026-03-10; use `resources.core`.
	const rl = await fetch(`${BASE}/rate_limit`, { headers: authHeaders() });
	const rlBody = await rl.json().catch(() => null);
	const limit = rlBody?.resources?.core?.limit ?? rlBody?.rate?.limit ?? "unknown";

	console.log(`Rate-limit : ${limit} req/h  (app ≈ 5 000, GITHUB_TOKEN ≈ 1 000)`);
	if (typeof limit === "number" && limit <= 1000) {
		console.error(
			"⚠️  Token looks like the default GITHUB_TOKEN, NOT an App installation token!\n" +
				"    The create-app-token step may have been skipped or its output was empty."
		);
	}

	// ── 2. Installation repository count ────────────────────────────────
	//    GET /installation/repositories confirms the token is a valid
	//    installation token and shows how many repos it can access.
	//    Note: this endpoint does NOT return installation-level permissions
	//    at the top level — permissions are per-repo inside `repositories[]`.
	const instRes = await fetch(`${BASE}/installation/repositories?per_page=1`, {
		headers: authHeaders()
	});
	if (instRes.ok) {
		const instBody = await instRes.json();
		console.log(`Install    : ✅ Valid installation token — ${instBody.total_count ?? "unknown"} repos accessible`);
	} else {
		console.log(`Install    : ❌ GET /installation/repositories → ${instRes.status} (not an installation token?)`);
	}

	// ── 3. Targeted label write test ────────────────────────────────────
	//    The most conclusive proof: try to create a temporary label on the
	//    .github repo, then immediately delete it.
	const testRepo = `${ORG}/.github`;
	const testLabel = `__sync-diag-${Date.now()}`;
	const writeRes = await fetch(`${BASE}/repos/${testRepo}/labels`, {
		method: "POST",
		headers: { ...authHeaders(), "Content-Type": "application/json" },
		body: JSON.stringify({
			name: testLabel,
			color: "000000",
			description: "Temporary diagnostic label — safe to delete"
		})
	});

	if (writeRes.ok) {
		console.log(`Label write: ✅ CONFIRMED on ${testRepo}`);
		// Clean up the test label immediately
		await fetch(`${BASE}/repos/${testRepo}/labels/${encodeURIComponent(testLabel)}`, {
			method: "DELETE",
			headers: authHeaders()
		});
	} else {
		const body = await writeRes.text();
		const accepted = writeRes.headers.get("x-accepted-github-permissions") || "(not present)";
		console.error(`Label write: ❌ DENIED on ${testRepo}  (HTTP ${writeRes.status})`);
		console.error(`  Response  : ${body}`);
		console.error(`  Required  : ${accepted}`);
		console.error("  Possible causes:");
		console.error("    1. The app installation's 'Issues' permission is not 'Read & write'");
		console.error("    2. The org admin has not accepted a pending permission upgrade");
		console.error("    3. The token fell through to github.token (check rate-limit above)");
	}

	console.log("::endgroup::");
}

await validateToken();

/**
 * Makes an authenticated GitHub API request.
 * @param {string} path - API path (e.g. "/orgs/CLDMV/repos")
 * @param {object} [options] - fetch options (method, body, etc.)
 * @returns {Promise<{status: number, body: any}>}
 */
async function api(path, options = {}) {
	const url = path.startsWith("http") ? path : `${BASE}${path}`;
	const res = await fetch(url, {
		...options,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2026-03-10",
			"Content-Type": "application/json",
			...(options.headers || {})
		}
	});

	let body = null;
	const text = await res.text();
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}

	if (DEBUG) console.log(`[${options.method || "GET"}] ${url} → ${res.status}`);
	return { status: res.status, body };
}

/**
 * Paginates through a GitHub API list endpoint, returning all items.
 * @param {string} path - API path (without per_page/page)
 * @returns {Promise<Array>}
 */
async function paginate(path) {
	const results = [];
	const sep = path.includes("?") ? "&" : "?";
	let url = `${BASE}${path}${sep}per_page=100`;

	while (url) {
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${TOKEN}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2026-03-10"
			}
		});

		const text = await res.text();
		let body;
		try {
			body = JSON.parse(text);
		} catch {
			body = [];
		}

		if (!res.ok) {
			console.error(`Pagination error ${res.status} on ${url}: ${text}`);
			break;
		}

		results.push(...(Array.isArray(body) ? body : []));

		// Follow Link: <next> header if present
		const link = res.headers.get("link") || "";
		const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
		url = next;
	}

	return results;
}

// ─── Label helpers ─────────────────────────────────────────────────────────────

/**
 * Loads the canonical labels from the JSON file.
 * @returns {Array<{name: string, color: string, description: string, aliases: string[]}>}
 */
function loadCanonicalLabels() {
	return JSON.parse(readFileSync(LABELS_JSON_PATH, "utf8"));
}

/**
 * Builds a case-insensitive map of alias/name → canonical label object.
 * @param {Array} canonicalLabels
 * @returns {Map<string, object>}
 */
function buildAliasMap(canonicalLabels) {
	const map = new Map();
	for (const label of canonicalLabels) {
		map.set(label.name.toLowerCase(), label);
		for (const alias of label.aliases ?? []) {
			map.set(alias.toLowerCase(), label);
		}
	}
	return map;
}

// ─── Per-repo sync ─────────────────────────────────────────────────────────────

/**
 * Checks if .labelignore exists in the repo's default branch.
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<boolean>}
 */
async function hasLabelIgnore(owner, repo) {
	const { status } = await api(`/repos/${owner}/${repo}/contents/.labelignore`);
	return status === 200;
}

/**
 * Fetches all current labels for a repo.
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<Array<{name: string, color: string, description: string}>>}
 */
async function getRepoLabels(owner, repo) {
	return paginate(`/repos/${owner}/${repo}/labels`);
}

/**
 * Syncs labels for a single repo and returns a change report.
 * @param {string} owner
 * @param {string} repo
 * @param {Array} canonicalLabels
 * @param {Map} aliasMap
 * @returns {Promise<{skipped: boolean, reason?: string, changes: string[], errors: string[]}>}
 */
async function syncRepo(owner, repo, canonicalLabels, aliasMap) {
	const report = { skipped: false, changes: [], errors: [] };

	// ── Skip check ──
	if (await hasLabelIgnore(owner, repo)) {
		report.skipped = true;
		report.reason = "`.labelignore` present";
		return report;
	}

	const currentLabels = await getRepoLabels(owner, repo);
	if (DEBUG) console.log(`  ${repo}: ${currentLabels.length} existing labels`);

	// Track which canonical labels are already present (by name) after processing
	const canonicalPresent = new Set();

	// Build a set of current label names (lowercased) for collision detection
	const currentNameSet = new Set(currentLabels.map((l) => l.name.toLowerCase()));

	// ── Pass 1: rename / update / delete existing labels ──
	for (const current of currentLabels) {
		const canonical = aliasMap.get(current.name.toLowerCase());

		if (!canonical) {
			// No match at all → delete
			if (!DRY_RUN) {
				const { status, body } = await api(`/repos/${owner}/${repo}/labels/${encodeURIComponent(current.name)}`, { method: "DELETE" });
				if (status !== 204) {
					report.errors.push(`Failed to delete \`${current.name}\` (HTTP ${status}): ${typeof body === "object" ? body?.message : body}`);
					continue;
				}
			}
			report.changes.push(`🗑️  Deleted \`${current.name}\``);
			continue;
		}

		canonicalPresent.add(canonical.name);

		// Determine what needs changing
		const needsRename = current.name !== canonical.name;
		const needsColorUpdate = current.color.toLowerCase() !== canonical.color.toLowerCase();
		const needsDescUpdate = (current.description ?? "") !== (canonical.description ?? "");

		if (!needsRename && !needsColorUpdate && !needsDescUpdate) {
			// Already perfect
			continue;
		}

		// If this is an alias AND the canonical name already exists as a
		// separate label, we can't rename — just delete the alias.
		// The canonical label will be updated when we encounter it.
		if (needsRename && currentNameSet.has(canonical.name.toLowerCase())) {
			if (!DRY_RUN) {
				const { status, body } = await api(`/repos/${owner}/${repo}/labels/${encodeURIComponent(current.name)}`, { method: "DELETE" });
				if (status !== 204) {
					report.errors.push(
						`Failed to delete alias \`${current.name}\` (HTTP ${status}): ${typeof body === "object" ? body?.message : body}`
					);
					continue;
				}
			}
			report.changes.push(`🗑️  Deleted alias \`${current.name}\` (canonical \`${canonical.name}\` already exists)`);
			continue;
		}

		const patchBody = {
			new_name: canonical.name,
			color: canonical.color,
			description: canonical.description ?? ""
		};

		if (!DRY_RUN) {
			const { status, body } = await api(`/repos/${owner}/${repo}/labels/${encodeURIComponent(current.name)}`, {
				method: "PATCH",
				body: JSON.stringify(patchBody)
			});
			if (status !== 200) {
				report.errors.push(`Failed to update \`${current.name}\` (HTTP ${status}): ${typeof body === "object" ? body?.message : body}`);
				continue;
			}
		}

		const parts = [];
		if (needsRename) {
			parts.push(`renamed \`${current.name}\` → \`${canonical.name}\``);
		} else {
			parts.push(`\`${canonical.name}\``);
		}
		if (needsColorUpdate) parts.push(`color \`#${current.color}\` → \`#${canonical.color}\``);
		if (needsDescUpdate) parts.push(`description updated`);
		report.changes.push(`✏️  ${parts.join(", ")}`);
	}

	// ── Pass 2: create missing canonical labels ──
	for (const canonical of canonicalLabels) {
		if (canonicalPresent.has(canonical.name)) continue;

		if (!DRY_RUN) {
			const { status, body } = await api(`/repos/${owner}/${repo}/labels`, {
				method: "POST",
				body: JSON.stringify({
					name: canonical.name,
					color: canonical.color,
					description: canonical.description ?? ""
				})
			});
			if (status !== 201) {
				report.errors.push(`Failed to create \`${canonical.name}\` (HTTP ${status}): ${typeof body === "object" ? body?.message : body}`);
				continue;
			}
		}

		report.changes.push(`➕ Created \`${canonical.name}\``);
	}

	return report;
}

// ─── Summary helpers ───────────────────────────────────────────────────────────

/**
 * Returns a Markdown link to a GitHub repo.
 * @param {string} repo
 * @returns {string}
 */
function repoLink(repo) {
	return `[${repo}](https://github.com/${ORG}/${repo})`;
}

/**
 * Appends a line to the GitHub Actions step summary.
 * @param {string} line
 */
function summary(line) {
	if (SUMMARY_FILE) {
		appendFileSync(SUMMARY_FILE, `${line}\n`);
	} else {
		console.log(line);
	}
}

// ─── Main ──────────────────────────────────────────────────────────────────────

const canonicalLabels = loadCanonicalLabels();
const aliasMap = buildAliasMap(canonicalLabels);

console.log(`📋 Loaded ${canonicalLabels.length} canonical labels from ${LABELS_JSON_PATH}`);
console.log(`🏢 Syncing labels for org: ${ORG}${DRY_RUN ? " (DRY RUN)" : ""}`);

// Fetch all repos in the org, sort alphabetically
const allRepos = (await paginate(`/orgs/${ORG}/repos`)).sort((a, b) => a.name.localeCompare(b.name));
console.log(`📦 Found ${allRepos.length} repositories`);

// Write summary header
summary(`# 🏷️ Org Label Sync — ${ORG}`);
if (DRY_RUN) summary(`\n> ⚠️ **Dry run** — no changes were applied.\n`);
summary(`> ${allRepos.length} repositories checked · ${canonicalLabels.length} canonical labels · ${new Date().toUTCString()}\n`);

let reposChanged = 0;
let reposClean = 0;
let reposSkipped = 0;
let reposErrored = 0;

// Repos that are already clean — collected and written at the end
const cleanRepos = [];

// Archived/disabled repos — collected and written at the end (avoids log spam)
const archivedOrDisabledRepos = [];

for (const repoData of allRepos) {
	const repo = repoData.name;
	const isArchived = repoData.archived;
	const isDisabled = repoData.disabled;

	if (isArchived || isDisabled) {
		archivedOrDisabledRepos.push({ name: repo, reason: isArchived ? "archived" : "disabled" });
		reposSkipped++;
		continue;
	}

	console.log(`\nProcessing: ${repo}`);

	let report;
	try {
		report = await syncRepo(ORG, repo, canonicalLabels, aliasMap);
	} catch (err) {
		summary(`\n---\n\n## 📦 ${repoLink(repo)}\n\n❌ Error: ${err.message}`);
		console.error(`  Error processing ${repo}:`, err);
		reposErrored++;
		continue;
	}

	if (report.skipped) {
		summary(`\n---\n\n## 📦 ${repoLink(repo)}\n\n⏭️ Skipped — ${report.reason}`);
		reposSkipped++;
		continue;
	}

	const hasErrors = report.errors.length > 0;
	const hasChanges = report.changes.length > 0;

	if (!hasChanges && !hasErrors) {
		// Defer clean repos to the end summary
		cleanRepos.push(repo);
		reposClean++;
		continue;
	}

	summary(`\n---\n\n## 📦 ${repoLink(repo)}`);

	if (hasChanges) {
		summary(`\n${DRY_RUN ? "**Would apply:**" : "**Changes applied:**"}`);
		for (const change of report.changes) {
			summary(`- ${change}`);
		}
	}

	if (hasErrors) {
		summary(`\n**Errors:**`);
		for (const err of report.errors) {
			summary(`- ⚠️ ${err}`);
		}
		reposErrored++;
	} else {
		reposChanged++;
	}
}

// Final totals
summary(`\n---\n\n## 📊 Summary\n`);
summary(`| | Count |`);
summary(`|---|---|`);
summary(`| ✅ Already up to date | ${reposClean} |`);
summary(`| ✏️ Updated | ${reposChanged} |`);
summary(`| ⏭️ Skipped | ${reposSkipped} |`);
summary(`| ❌ Errors | ${reposErrored} |`);
summary(`| **Total** | **${allRepos.length}** |`);

// List clean repos in a collapsed section at the end
if (cleanRepos.length > 0) {
	summary(`\n---\n\n## ✅ Already Up To Date (${cleanRepos.length})\n`);
	for (const repo of cleanRepos) {
		summary(`- ${repoLink(repo)}`);
	}
}

if (archivedOrDisabledRepos.length > 0) {
	summary(`\n---\n\n## ⏭️ Archived / Disabled (${archivedOrDisabledRepos.length})\n`);
	for (const { name, reason } of archivedOrDisabledRepos) {
		summary(`- ${repoLink(name)} _(${reason})_`);
	}
}

console.log(`\n✅ Done. Changed: ${reposChanged}, Clean: ${reposClean}, Skipped: ${reposSkipped}, Errors: ${reposErrored}`);

if (reposErrored > 0) process.exit(1);
