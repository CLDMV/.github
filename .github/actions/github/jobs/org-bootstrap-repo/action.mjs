/**
 * @fileoverview Per-repo bootstrap. Applies the v4 org baseline to ONE repo:
 *   - create next/hotfixes if missing
 *   - flip repo settings (auto-merge, delete-branch-on-merge, merge methods)
 *   - enable always-free security toggles (Dependabot alerts + security
 *     updates, private vulnerability reporting, Dependabot security update
 *     PRs)
 *   - replace the three rulesets from the shared builders module
 *
 * Opt-in paid-on-private security products (3-way: off | public-only | all,
 * default off; both are free on public, paid on private):
 *   - GitHub Code Security (CodeQL alerts surface): `code_security`
 *   - Secret Protection (scanning + push protection): `secret_protection`
 *
 * Overwrites diverged values and emits a warning per divergence so the
 * audit trail captures what changed. Idempotent — re-running is safe.
 *
 * Manual one-time toggles (NOT managed by this action because GitHub does
 * not expose them via REST, GraphQL, or gh CLI — confirmed against the
 * docs and community/community#188598):
 *   - Settings → General → Pull Requests → "Auto-close issues with merged
 *     linked pull requests" (recommended ON). Surfaced as a reminder line
 *     in the bootstrap summary so it's not silently missed.
 *
 * Called by:
 *   - local-org-onboarding.yml (matrix fanout across many repos)
 *   - examples/.../v4-bootstrap.yml (per-repo dispatch)
 *
 * @module @cldmv/.github.github.jobs.org-bootstrap-repo
 */

import { getInput, setOutput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";
import { buildAll, DEFAULT_OPTS } from "../../../../../docs/tools/ruleset-generator/builders.mjs";

const warnings = [];
const applied = [];
const manualSteps = [];

function warn(msg) {
	warnings.push(msg);
	console.log(`⚠️  ${msg}`);
}

function note(msg) {
	console.log(`ℹ️  ${msg}`);
}

function ok(msg, stepId) {
	console.log(`✅ ${msg}`);
	if (stepId) applied.push(stepId);
}

// Surface a manual one-time toggle that this action cannot manage (GitHub
// doesn't expose the setting via any API surface). Distinct from warn() so
// it doesn't read as "we overwrote your value" — there's nothing to overwrite.
function manual(msg) {
	manualSteps.push(msg);
	console.log(`📝 MANUAL: ${msg}`);
}

function finish(status, reason = "") {
	setOutput("status", status);
	setOutput("skip_reason", reason);
	setOutput("applied", applied.join(","));
	setOutput("warnings", warnings.join("\n"));
	if (status === "skipped") {
		appendSummary(`### ⏭️ Bootstrap skipped — ${reason}`);
	} else {
		appendSummary(`### ${status === "succeeded" ? "✅" : "❌"} Bootstrap ${status}`);
		if (applied.length) {
			appendSummary("");
			appendSummary(`**Applied:** ${applied.length} step(s)`);
			for (const a of applied) appendSummary(`- \`${a}\``);
		}
		if (warnings.length) {
			appendSummary("");
			appendSummary(`**Warnings (divergence from baseline — overwritten):**`);
			for (const w of warnings) appendSummary(`- ${w}`);
		}
		if (manualSteps.length) {
			appendSummary("");
			appendSummary(`**Manual one-time toggles (GitHub doesn't expose these via API — check the repo UI once):**`);
			for (const m of manualSteps) appendSummary(`- ${m}`);
		}
	}
	process.exit(status === "failed" ? 1 : 0);
}

async function main() {
	const token = getInput("github_token", { required: true });
	const dryRun = getInput("dry_run") !== "false";
	const stepsCsv = getInput("steps") || "branches,settings,security,rulesets";
	const steps = new Set(stepsCsv.split(",").map((s) => s.trim()).filter(Boolean));
	const nextBranch = getInput("next_branch") || "next";
	const hotfixesBranch = getInput("hotfixes_branch") || "hotfixes";
	const botAppId = parseInt(getInput("bot_app_id") || "1910694", 10);
	// Security feature policies are 3-way: "off" | "public-only" | "all".
	// public-only resolves per-repo against the visibility check below.
	//
	// `code_security` is the operator-facing name (matches the unbundled
	// product name); internally it drives the `security_and_analysis.advanced_security`
	// API field — GitHub kept the legacy field name after unbundling.
	const codeSecurityPolicy = (getInput("code_security") || "off").toLowerCase();
	const secretProtectionPolicy = (getInput("secret_protection") || "off").toLowerCase();
	for (const [name, val] of [
		["code_security", codeSecurityPolicy],
		["secret_protection", secretProtectionPolicy]
	]) {
		if (!["off", "public-only", "all"].includes(val)) {
			throw new Error(`Invalid ${name}: "${val}" (expected one of: off, public-only, all)`);
		}
	}

	const targetRepo = getInput("target_repo") || process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = targetRepo.split("/");
	if (!owner || !repo) throw new Error(`Invalid target_repo: "${targetRepo}" (expected owner/name)`);

	const ctx = { token, owner, repo };
	console.log(`🚀 Bootstrap ${owner}/${repo}  (dry_run=${dryRun}, steps=${[...steps].join("+")})`);

	/** Wrap a mutating call so dry_run suppresses the fire-the-API part. */
	async function mutate(method, path, body, label) {
		if (dryRun) {
			console.log(`🔸 [dry-run] would ${method} ${path}`);
			return null;
		}
		return api(method, path, body, ctx);
	}

	// ── PRECHECK ───────────────────────────────────────────────────────────
	let repoInfo;
	try {
		repoInfo = await api("GET", "", null, ctx);
	} catch (err) {
		throw new Error(`Could not GET repo ${owner}/${repo}: ${err.message}`);
	}
	if (repoInfo.archived) return finish("skipped", "archived");
	const defaultBranch = repoInfo.default_branch || "master";
	if (defaultBranch !== "master") {
		warn(`default branch is "${defaultBranch}", not master — proceeding with that as the master analog`);
	}

	let defaultBranchSha;
	try {
		const ref = await api("GET", `/git/ref/heads/${defaultBranch}`, null, ctx);
		defaultBranchSha = ref.object?.sha || "";
	} catch (err) {
		return finish("skipped", `no commits on default branch ${defaultBranch}`);
	}
	if (!defaultBranchSha) return finish("skipped", `default branch ${defaultBranch} has no HEAD`);

	// ── BRANCHES ──────────────────────────────────────────────────────────
	if (steps.has("branches")) {
		for (const branch of [nextBranch, hotfixesBranch]) {
			let exists = false;
			let existingSha = "";
			try {
				const ref = await api("GET", `/git/ref/heads/${branch}`, null, ctx);
				exists = true;
				existingSha = ref.object?.sha || "";
			} catch (err) {
				if (!err.message.includes("404")) throw err;
			}
			if (exists) {
				if (existingSha !== defaultBranchSha) {
					note(`${branch} exists at ${existingSha.slice(0, 7)} (diverged from ${defaultBranch}@${defaultBranchSha.slice(0, 7)}) — leaving alone`);
				} else {
					note(`${branch} already at ${defaultBranch} HEAD — no-op`);
				}
				applied.push(`branch.${branch}.existed`);
				continue;
			}
			await mutate("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: defaultBranchSha }, `create ${branch}`);
			ok(`created ${branch} at ${defaultBranchSha.slice(0, 7)}`, `branch.${branch}.created`);
		}
	}

	// ── REPO SETTINGS ─────────────────────────────────────────────────────
	if (steps.has("settings")) {
		const expected = {
			allow_auto_merge: true,
			delete_branch_on_merge: false,
			allow_squash_merge: true,
			allow_merge_commit: true,
			allow_rebase_merge: false,
			allow_update_branch: true,
			web_commit_signoff_required: false
		};
		const diff = {};
		for (const [k, v] of Object.entries(expected)) {
			const actual = repoInfo[k];
			if (actual !== v) {
				warn(`setting \`${k}\` was \`${actual}\`, overwriting to \`${v}\``);
				diff[k] = v;
			}
		}
		if (Object.keys(diff).length > 0) {
			await mutate("PATCH", "", diff, "patch repo settings");
			ok(`patched repo settings: ${Object.keys(diff).join(", ")}`, "settings.patched");
		} else {
			note("repo settings already match baseline");
			applied.push("settings.already-correct");
		}

		// Surface the one PR-settings toggle GitHub doesn't expose via API.
		// Repeats every run because we can't read its current state to
		// suppress the reminder once it's been flipped — that's the price
		// of GitHub's API gap. Worded as a check, not an alarm.
		manual(
			"Settings → General → Pull Requests → \"Auto-close issues with merged linked pull requests\" — confirm ON (UI-only; not in REST/GraphQL/gh CLI)."
		);
	}

	// ── SECURITY ──────────────────────────────────────────────────────────
	if (steps.has("security")) {
		// Dependabot vulnerability alerts. GET returns 204 if enabled, 404 if not.
		try {
			await api("GET", "/vulnerability-alerts", null, ctx);
			note("vulnerability-alerts already enabled");
			applied.push("security.vuln-alerts.already-on");
		} catch (err) {
			if (!err.message.includes("404")) throw err;
			warn("vulnerability-alerts was OFF, turning ON");
			await mutate("PUT", "/vulnerability-alerts", null, "enable vulnerability-alerts");
			ok("enabled vulnerability-alerts", "security.vuln-alerts.enabled");
		}

		// Automated security fixes (the auto-PR creation for vuln fixes).
		// Same GET-204-vs-404 protocol.
		try {
			await api("GET", "/automated-security-fixes", null, ctx);
			note("automated-security-fixes already enabled");
			applied.push("security.auto-fixes.already-on");
		} catch (err) {
			if (!err.message.includes("404")) throw err;
			warn("automated-security-fixes was OFF, turning ON");
			await mutate("PUT", "/automated-security-fixes", null, "enable automated-security-fixes");
			ok("enabled automated-security-fixes", "security.auto-fixes.enabled");
		}

		// Private vulnerability reporting. 404/403 from this endpoint means
		// the feature isn't available on this repo — usually because the
		// org-level policy hasn't turned it on. Surface where to enable it.
		try {
			const prv = await api("GET", "/private-vulnerability-reporting", null, ctx);
			if (prv?.enabled) {
				note("private-vulnerability-reporting already enabled");
				applied.push("security.pvr.already-on");
			} else {
				warn("private-vulnerability-reporting was OFF, turning ON");
				await mutate("PUT", "/private-vulnerability-reporting", null, "enable PVR");
				ok("enabled private-vulnerability-reporting", "security.pvr.enabled");
			}
		} catch (err) {
			if (err.message.includes("404") || err.message.includes("403")) {
				const code = err.message.match(/\b40[34]\b/)?.[0] || "feature-unavailable";
				note(
					`private-vulnerability-reporting unavailable on \`${owner}/${repo}\` (HTTP ${code}). To enable: ` +
						`https://github.com/${owner}/${repo}/settings/security_analysis → "Private vulnerability reporting" → Enable. ` +
						`If toggle is greyed out, org admin must allow PVR at ` +
						`https://github.com/organizations/${owner}/settings/security_analysis first.`
				);
				applied.push("security.pvr.unavailable");
			} else {
				warn(`could not check private-vulnerability-reporting: ${err.message} — skipping`);
			}
		}

		// security_and_analysis baseline.
		//
		// Every field below is driven by operator input (overwrite-with-warn,
		// same as the rest of the bootstrap). The two paid-on-private products
		// (Code Security + Secret Protection — both gated by GitHub billing
		// on private repos, free on public) use a 3-way policy resolved
		// per-repo against the repo's visibility:
		//
		//   code_security: off          → disable everywhere
		//   code_security: public-only  → enable on public (free), disable on private (paid)
		//   code_security: all          → enable everywhere (paid for private)
		//   (secret_protection has the same shape; secret_scanning +
		//    secret_scanning_push_protection move together as one feature.)
		//
		// `dependabot_security_updates` is always on — free everywhere, and
		// there's no reason to disable security update PRs.
		//
		// Both policy inputs default to `off`, so a vanilla bootstrap run
		// keeps both paid products off on every repo — safe stance for an
		// org-wide fanout. `public-only` is the zero-cost middle ground:
		// enables wherever the feature is free (public repos) and leaves it
		// off where it'd cost money (private/internal).
		//
		// API field names: GitHub didn't rename `advanced_security` when it
		// unbundled GHAS into Code Security + Secret Protection — that field
		// is now what gates Code Security per-repo. So the operator input
		// `code_security` drives the `advanced_security` field below; the
		// `secret_*` fields drive Secret Protection.
		const isPrivate = !!repoInfo.private; // covers private + internal
		const codeSecOnHere = codeSecurityPolicy === "all" || (codeSecurityPolicy === "public-only" && !isPrivate);
		const secProtOnHere = secretProtectionPolicy === "all" || (secretProtectionPolicy === "public-only" && !isPrivate);
		const saExpected = {
			dependabot_security_updates: { status: "enabled" },
			secret_scanning: { status: secProtOnHere ? "enabled" : "disabled" },
			secret_scanning_push_protection: { status: secProtOnHere ? "enabled" : "disabled" }
		};

		// `advanced_security` is org-managed on modern setups. Heuristic:
		// only attempt to PATCH it per-repo when the API response actually
		// INCLUDES the field. Two scenarios where it's absent:
		//   - Public repos: field doesn't exist (features are free, not
		//     gated). PATCH 422s with "not available, not a pre-requisite".
		//   - Private repos covered by an org-level Code Security
		//     Configuration: field is hidden from the response because the
		//     org config controls it. PATCH 422s with the same message.
		// In both cases the field's effective state is "not user-settable
		// via this endpoint" — only org-level config can change it.
		const repoAdvSec = repoInfo.security_and_analysis?.advanced_security?.status;
		if (repoAdvSec) {
			// Field present in the response → settable per-repo.
			saExpected.advanced_security = { status: codeSecOnHere ? "enabled" : "disabled" };
		} else if (codeSecurityPolicy !== "off") {
			// Operator wants GHAS managed but this repo is org-config-driven.
			// The per-repo `security_and_analysis.advanced_security` field
			// is hidden from the API response because an org-level Code
			// Security Configuration owns it. To change Advanced Security
			// on this repo, an org admin manages it via the org's Code
			// Security settings (location varies by GitHub UI version —
			// look under org Settings for Code security / Code Security
			// configurations).
			note(
				`code_security policy is \`${codeSecurityPolicy}\` but Advanced Security on \`${owner}/${repo}\` ` +
					`is managed by an org-level Code Security Configuration (the per-repo \`security_and_analysis.advanced_security\` ` +
					`field is absent from the API response). Change via your org's Code security settings.`
			);
			applied.push("security.advanced-security.org-managed");
		}
		const saCurrent = repoInfo.security_and_analysis || {};
		const saDiff = {};
		for (const [k, v] of Object.entries(saExpected)) {
			const actual = saCurrent[k]?.status;
			const expected = v.status;
			if (actual !== expected) {
				warn(`security_and_analysis.${k} was \`${actual || "unset"}\`, overwriting to \`${expected}\``);
				saDiff[k] = v;
			}
		}
		if (Object.keys(saDiff).length > 0) {
			try {
				await mutate("PATCH", "", { security_and_analysis: saDiff }, "patch security_and_analysis");
				ok(`patched security_and_analysis: ${Object.keys(saDiff).join(", ")}`, "security.sa.patched");
			} catch (err) {
				warn(
					`security_and_analysis PATCH failed on \`${owner}/${repo}\`: ${err.message}. ` +
						`Private repos need GitHub Advanced Security for secret scanning + push protection. ` +
						`Enable at https://github.com/${owner}/${repo}/settings/security_analysis ` +
						`(or org-wide at https://github.com/organizations/${owner}/settings/security_analysis) and re-run the bootstrap.`
				);
			}
		} else {
			note("security_and_analysis already matches baseline");
			applied.push("security.sa.already-correct");
		}

		// CodeQL default setup vs. custom codeql.yml workflow conflict.
		//
		// GitHub blocks SARIF uploads from the advanced (custom workflow)
		// configuration when the repo's default setup is `configured`:
		//
		//   "Code Scanning could not process the submitted SARIF file: CodeQL
		//    analyses from advanced configurations cannot be processed when
		//    the default setup is enabled"
		//
		// Our scaffolding ships an advanced `codeql.yml` workflow (consumers
		// adopt it from examples/individual-repo-workflows/security/), so
		// default setup being on means CodeQL will start failing the moment
		// the consumer runs their first CI. The baseline is therefore
		// `not-configured` — overwrite-with-warn like the rest of the
		// security phase. Operators who actually prefer default setup
		// should delete their custom codeql.yml; the next bootstrap
		// re-runs and leaves default setup alone if the conflict is gone.
		try {
			const ds = await api("GET", "/code-scanning/default-setup", null, ctx);
			if (ds?.state === "configured") {
				warn(`CodeQL default setup was \`configured\`, overwriting to \`not-configured\` (conflicts with the custom codeql.yml workflow)`);
				try {
					await mutate("PATCH", "/code-scanning/default-setup", { state: "not-configured" }, "disable CodeQL default setup");
					ok("disabled CodeQL default setup", "security.codeql-default-setup.disabled");
				} catch (err) {
					warn(`disable CodeQL default setup failed: ${err.message}`);
				}
			} else {
				note(`CodeQL default setup state: \`${ds?.state || "unset"}\` (no conflict)`);
				applied.push("security.codeql-default-setup.ok");
			}
		} catch (err) {
			// 404 → endpoint never touched on this repo (no conflict).
			// 403 → "Code Security must be enabled" — i.e. private repo
			//       without GHAS, where code scanning isn't available at
			//       all. Default setup can't be configured here either,
			//       so the conflict can't exist. Same effective answer
			//       as 404: nothing to do, but tell the operator where
			//       to enable code scanning if they want it.
			if (err.message.includes("404")) {
				note("CodeQL default setup not configured (404) — no conflict");
				applied.push("security.codeql-default-setup.ok");
			} else if (err.message.includes("403") && err.message.includes("Code Security")) {
				note(
					`Code scanning unavailable on \`${owner}/${repo}\` (private repo without GitHub Advanced Security). ` +
						`No CodeQL conflict to resolve. To enable code scanning here: enable GHAS at ` +
						`https://github.com/${owner}/${repo}/settings/security_analysis (Code security and analysis → Enable). ` +
						`Org-wide GHAS toggle: https://github.com/organizations/${owner}/settings/security_analysis. ` +
						`Alternative: make the repo public (GHAS is free on public repos), or delete the custom codeql.yml ` +
						`if this repo shouldn't run code scanning.`
				);
				applied.push("security.codeql-default-setup.unavailable");
			} else {
				warn(`could not check CodeQL default setup on \`${owner}/${repo}\`: ${err.message}`);
			}
		}
	}

	// ── RULESETS ──────────────────────────────────────────────────────────
	if (steps.has("rulesets")) {
		const desired = buildAll({ ...DEFAULT_OPTS, botAppId });
		const existing = await api("GET", "/rulesets", null, ctx);
		const byName = new Map((existing || []).map((r) => [r.name, r]));

		for (const [branchKey, ruleset] of Object.entries(desired)) {
			const match = byName.get(ruleset.name);
			if (match) {
				warn(`ruleset "${ruleset.name}" already exists (id=${match.id}) — replacing per overwrite-with-warn policy`);
				await mutate("DELETE", `/rulesets/${match.id}`, null, `delete existing ruleset ${match.id}`);
				await mutate("POST", "/rulesets", ruleset, `create ruleset ${ruleset.name}`);
				ok(`replaced ruleset "${ruleset.name}"`, `rulesets.${branchKey}.replaced`);
			} else {
				await mutate("POST", "/rulesets", ruleset, `create ruleset ${ruleset.name}`);
				ok(`created ruleset "${ruleset.name}"`, `rulesets.${branchKey}.created`);
			}
		}
	}

	finish("succeeded");
}

main().catch((error) => {
	console.error(`::error::${error.message}`);
	if (error.stack) console.error(error.stack);
	warnings.push(`FATAL: ${error.message}`);
	finish("failed");
});
