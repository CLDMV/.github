/**
 * @fileoverview Redirect a PR's base branch to the hotfix lane when either:
 *   - The head branch matches the hotfix/security pattern (existing behavior,
 *     §6.5 of the v4 design — docs/conventions/release-flow-v4.md), OR
 *   - The PR is a Dependabot **security** update (author = dependabot[bot]
 *     AND its base isn't Dependabot's routine `target-branch` — see
 *     isDependabotSecurityPR below for why base-mismatch, not body text, is
 *     the detection signal). Dependabot routine bumps still skip; only
 *     security PRs are redirected.
 *
 * The two kinds are handled differently on purpose:
 *
 *   - "hotfix" (human-authored, head matches the branch pattern): a plain
 *     PATCH of `base`. These are reviewed by a human before merge, and per
 *     this org's branch-discipline conventions the branch should already be
 *     rooted at `next`/`hotfixes` correctly.
 *
 *   - "dependabot-security": NOT a plain base PATCH. Dependabot always forks
 *     its update branch from `next` (dependabot.yml's configured
 *     target-branch — Dependabot has no per-update "security only" target,
 *     so this redirect-after-the-fact is the only way to route security
 *     bumps to the hotfix lane at all). Patching `base` alone does not
 *     rebase that branch: if `next` has already diverged from `hotfixes`
 *     (i.e. picked up other pooled work) by the time Dependabot forks, a
 *     normal merge of the raw branch into `hotfixes` drags that entire
 *     unrelated slice of `next`'s history into `hotfixes` along with it —
 *     `hotfixes` is supposed to stay rooted at master. And because Dependabot
 *     PRs are zero-touch auto-merged (dependabot-auto-merge), there is no
 *     human in the loop to notice. So instead this cherry-picks just the
 *     Dependabot commit(s) onto a fresh branch cut from `hotfixes`' own tip,
 *     opens a replacement PR against `hotfixes` from that clean branch, and
 *     closes the original. The replacement stays on the same zero-touch path
 *     via the shared approve+auto-merge helper.
 *
 * Pure logic functions are exported for test.mjs. Side-effecting main is
 * gated to script-entry only.
 *
 * @module @cldmv/.github.github.steps.redirect-hotfix-pr
 */

import { execFileSync } from "node:child_process";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { approveAndEnableAutoMerge } from "../../api/_api/auto-merge.mjs";
import { buildRemoteUrl, redactToken } from "../../../git/steps/force-reset-branch/action.mjs";
import { getInput, setOutputs, getBooleanInput } from "../../../common/common/core.mjs";

export const COMMENT_SENTINEL = "_Auto-redirected PR base:_";

/**
 * Compile the head-branch pattern. Accepts a regex source string; returns
 * a RegExp anchored at the start of the ref.
 *
 * @public
 */
export function compilePattern(source) {
	const src = (source || "").trim() || "^(hotfix|security)/";
	return new RegExp(src);
}

/**
 * Detect a Dependabot security-advisory PR.
 *
 * Primary signal: GitHub's Dependabot security updates always target the
 * repository's **default branch**, ignoring `dependabot.yml`'s configured
 * `target-branch` (there is no per-update "security only" target — this is
 * documented GitHub behavior, not a per-repo misconfiguration). So any
 * Dependabot PR whose base isn't the routine target-branch is, by
 * construction, a security override. This is checked first because it's
 * grounded in behavior GitHub guarantees, not in Dependabot's PR body
 * template — confirmed empirically (CLDMV/slothlet PRs #225/#230/#233) that
 * current Dependabot security-update PR bodies do NOT embed a literal GHSA
 * id or advisory URL, so body-text sniffing alone silently never fires.
 *
 * Secondary signal (OR'd in): a literal GHSA-id token or
 * `github.com/advisories/GHSA-…` link in the body, kept for repos that don't
 * set `target-branch` (so base-mismatch can never fire) or in case
 * Dependabot's template later reintroduces the id.
 *
 * @public
 * @param {object} opts
 * @param {string} opts.userLogin - PR author's login (e.g. "dependabot[bot]")
 * @param {string} [opts.prBody] - PR body / description text
 * @param {string} [opts.baseRef] - PR's current base branch
 * @param {string} [opts.dependabotBase] - Branch Dependabot's routine version updates target (dependabot.yml's `target-branch`, e.g. "next")
 * @returns {boolean}
 */
export function isDependabotSecurityPR({ userLogin, prBody, baseRef, dependabotBase }) {
	if (userLogin !== "dependabot[bot]") return false;
	if (dependabotBase && baseRef && baseRef !== dependabotBase) return true;
	if (!prBody) return false;
	// A GHSA advisory URL always embeds the GHSA id, so this bare-id check already
	// covers the URL form — a separate (unanchored) URL regex adds nothing.
	const ghsaId = /\bGHSA-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}\b/;
	return ghsaId.test(prBody);
}

/**
 * Decide whether to skip redirection. Returns { skip, reason, redirectKind }
 * where redirectKind is "hotfix" or "dependabot-security" when skip=false,
 * indicating *why* the PR is being redirected (used to pick the right
 * explanatory comment and the right redirect mechanism).
 *
 * @public
 */
export function shouldSkip({ userType, userLogin, headRef, baseRef, targetBase, headPattern, prBody, dependabotBase }) {
	// Dependabot security PRs override the usual bot-skip rule.
	if (isDependabotSecurityPR({ userLogin, prBody, baseRef, dependabotBase })) {
		if (baseRef === targetBase) {
			return { skip: true, reason: `PR already targets '${targetBase}'`, redirectKind: null };
		}
		return { skip: false, reason: "", redirectKind: "dependabot-security" };
	}
	if (userType === "Bot") return { skip: true, reason: "PR author is a Bot", redirectKind: null };
	if (!headRef || !headPattern.test(headRef)) {
		return { skip: true, reason: `Head '${headRef}' does not match hotfix pattern ${headPattern}`, redirectKind: null };
	}
	if (baseRef === targetBase) {
		return { skip: true, reason: `PR already targets '${targetBase}'`, redirectKind: null };
	}
	return { skip: false, reason: "", redirectKind: "hotfix" };
}

/**
 * Build the explanatory comment body. `kind` selects the reason text:
 *   - "hotfix" (default): head branch matched the hotfix pattern.
 *   - "dependabot-security": PR is a Dependabot security advisory update.
 *
 * @public
 */
export function buildCommentBody(oldBase, newBase, kind = "hotfix") {
	if (kind === "dependabot-security") {
		return `${COMMENT_SENTINEL} retargeted this Dependabot PR from \`${oldBase}\` to \`${newBase}\` because it references a security advisory (GHSA). Security updates ship via the hotfix lane.\n\nIf this was misclassified, change the base back via the **Edit** button on the PR title — this workflow won't re-fire on subsequent edits.`;
	}
	return `${COMMENT_SENTINEL} retargeted this PR from \`${oldBase}\` to \`${newBase}\` because the head branch looks like a hotfix.\n\nIf this was not what you wanted, change the base back via the **Edit** button on the PR title — this workflow won't re-fire on subsequent edits.`;
}

/**
 * Deterministic branch name for the cherry-picked replacement, keyed on the
 * PR number so it can never collide across concurrent redirects.
 *
 * @public
 * @param {number|string} prNumber
 * @returns {string}
 */
export function buildReplacementBranchName(prNumber) {
	// Deliberately NOT prefixed "dependabot/" — this branch is authored by our
	// bot (a cherry-pick), not Dependabot, and Dependabot's own housekeeping
	// (recreate/rebase/cleanup) should never mistake it for one of its own.
	return `hotfix-redirect/pr-${prNumber}`;
}

/**
 * Body for the replacement PR opened against `targetBase`: a note explaining
 * the redirect, followed by the original PR's body (Dependabot's changelog
 * details are still useful to a reviewer).
 *
 * @public
 * @param {number|string} originalNumber
 * @param {string} originalBody
 * @param {string} [targetBase] - Branch the replacement targets. Default "hotfixes".
 * @returns {string}
 */
export function buildReplacementPrBody(originalNumber, originalBody, targetBase = "hotfixes") {
	const note = `_Supersedes #${originalNumber}._ Cherry-picked cleanly onto \`${targetBase}\`' own tip instead of merging Dependabot's branch as-is — that branch forks from \`next\`, and merging it directly would carry forward any of \`next\`'s pooled work that isn't on \`${targetBase}\` yet. See ${COMMENT_SENTINEL.replace(/^_|_$/g, "")} on #${originalNumber}.\n\n---\n`;
	return note + (originalBody || "");
}

/**
 * Comment posted on the original Dependabot PR when it's closed in favor of
 * the cherry-picked replacement.
 *
 * @public
 * @param {number|string} newNumber
 * @param {string} [targetBase] - Branch the replacement targets. Default "hotfixes".
 * @returns {string}
 */
export function buildSupersededCommentBody(newNumber, targetBase = "hotfixes") {
	return `${COMMENT_SENTINEL} closed in favor of #${newNumber}, which cherry-picks this same change onto \`${targetBase}\`' own tip instead of merging this branch (forked from \`next\`) as-is — see #${newNumber} for why.`;
}

/**
 * Given the observed git prerequisites for the dependabot-security cherry-pick
 * path, return the human-readable reason they are insufficient, or "" when they
 * are satisfied. Pure (no git calls) so it can be unit-tested; the git probing
 * that produces these booleans lives in the side-effecting wrapper below.
 *
 * The cherry-pick path (unlike the plain-PATCH hotfix path) needs the calling
 * workflow to have run a real checkout of the repo, configured a git identity,
 * AND imported a commit-signing key (the BOT_GPG_* secrets → user.signingkey +
 * commit.gpgsign) — see the module docstring. A caller workflow that predates
 * any of those requirements (an out-of-date copied `local-*`/example template)
 * would otherwise reach the cherry-pick under-provisioned:
 *   - No checkout or no identity: `git cherry-pick` runs via runCapturing, so
 *     the failure is silent-ish — a missing identity is misread as a *conflict*,
 *     posts a misleading "couldn't cherry-pick cleanly" comment, and exits 0
 *     (green), leaving the security PR on the default branch to be auto-merged.
 *   - No signing key: the cherry-pick succeeds but produces an UNSIGNED commit.
 *     Every CLDMV branch requires signed commits, so the redirected replacement
 *     PR then sits at `mergeable_state: blocked` with no failing check naming
 *     the cause — exactly the silent block reported in issue #257.
 * Detecting the missing prerequisite up front lets the caller fail loudly, with
 * a comment naming the actual cause, instead of any of these silent outcomes.
 *
 * @public
 * @param {object} state
 * @param {boolean} state.insideWorkTree - working directory is a git checkout.
 * @param {boolean} state.hasIdentity - both user.name and user.email are configured.
 * @param {boolean} state.canSign - a signing key (user.signingkey) AND commit.gpgsign are configured, so the cherry-picked commit will be signed.
 * @returns {string} Empty when prerequisites are met; otherwise why not.
 */
export function missingCherryPickPrereq({ insideWorkTree, hasIdentity, canSign }) {
	if (!insideWorkTree) return "the working directory is not a git checkout";
	if (!hasIdentity) return "no git identity (user.name / user.email) is configured";
	if (!canSign)
		return "commit signing is not configured (no user.signingkey / commit.gpgsign) — the cherry-picked commit would be unsigned and blocked by the branch's required-signatures rule";
	return "";
}

// ---- side-effecting main flow (gated to script entry only) ----------------

async function fetchPR(owner, repo, prNumber, token) {
	return api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
}

async function fetchPrCommitShas(owner, repo, prNumber, token) {
	const commits = await api("GET", `/pulls/${prNumber}/commits?per_page=100`, null, { token, owner, repo });
	return (commits || []).map((c) => c.sha);
}

async function patchBase(owner, repo, prNumber, newBase, token) {
	return api("PATCH", `/pulls/${prNumber}`, { base: newBase }, { token, owner, repo });
}

async function closePR(owner, repo, prNumber, token) {
	return api("PATCH", `/pulls/${prNumber}`, { state: "closed" }, { token, owner, repo });
}

async function hasSentinelComment(owner, repo, prNumber, token) {
	const comments = await api("GET", `/issues/${prNumber}/comments?per_page=100`, null, { token, owner, repo });
	return (comments || []).some((c) => typeof c?.body === "string" && c.body.includes(COMMENT_SENTINEL));
}

async function postComment(owner, repo, prNumber, body, token) {
	return api("POST", `/issues/${prNumber}/comments`, { body }, { token, owner, repo });
}

async function createPR(owner, repo, { title, head, base, body }, token) {
	return api("POST", "/pulls", { title, head, base, body }, { token, owner, repo });
}

async function addLabels(owner, repo, prNumber, labels, token) {
	if (!labels || labels.length === 0) return;
	await api("POST", `/issues/${prNumber}/labels`, { labels }, { token, owner, repo });
}

function run(file, args) {
	return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runCapturing(file, args) {
	try {
		const stdout = execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { ok: true, stdout, stderr: "" };
	} catch (e) {
		return { ok: false, stdout: e.stdout?.toString() || "", stderr: e.stderr?.toString() || e.message };
	}
}

/**
 * Probe the git prerequisites the cherry-pick path needs (a checkout, a
 * configured identity, and a commit-signing key) and return the reason they're
 * insufficient, or "" when they're met. The identity/signing reads are gated on
 * being inside a work tree only to report the more fundamental "not a checkout"
 * problem first — `git config` would otherwise succeed against global config
 * even with no repo present. Pure decision logic lives in
 * `missingCherryPickPrereq` (unit-tested).
 */
function checkCherryPickPrereqs() {
	const insideWorkTree = runCapturing("git", ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
	const name = insideWorkTree ? runCapturing("git", ["config", "--get", "user.name"]).stdout.trim() : "";
	const email = insideWorkTree ? runCapturing("git", ["config", "--get", "user.email"]).stdout.trim() : "";
	const signingKey = insideWorkTree ? runCapturing("git", ["config", "--get", "user.signingkey"]).stdout.trim() : "";
	const gpgSign = insideWorkTree ? runCapturing("git", ["config", "--get", "commit.gpgsign"]).stdout.trim() : "";
	return missingCherryPickPrereq({
		insideWorkTree,
		hasIdentity: Boolean(name) && Boolean(email),
		canSign: Boolean(signingKey) && gpgSign === "true"
	});
}

/**
 * Cherry-pick `commitShas` (oldest-first, as returned by
 * `GET /pulls/{pr}/commits`) onto a fresh branch cut from `targetBase`'s
 * current tip, and push it. Requires the working directory to already be a
 * checkout of the repo (any ref — this fetches what it needs) with a git
 * identity configured. Returns `{ ok: true, branch, headSha }` on success or
 * `{ ok: false, reason }` on a cherry-pick conflict (caller decides the safe
 * fallback — see module docstring: NOT a base-only PATCH, since that's the
 * exact contamination this exists to avoid).
 *
 * Not exported — it's pure side effect (git + push), covered by the pure
 * naming/body helpers above (unit-tested) plus manual/integration
 * verification, not a unit test with a mocked `git`.
 */
async function cherryPickOntoBranch({ remoteUrl, targetBase, branch, prNumber, commitShas }) {
	run("git", ["remote", "set-url", "origin", remoteUrl]);
	// Explicit destination + leading "+" (force update): a bare
	// `git fetch origin <branch>` only opportunistically updates the matching
	// remote-tracking ref depending on the repo's configured fetch refspec —
	// don't rely on that. checkout -B below needs origin/<targetBase> to
	// definitely be current.
	run("git", ["fetch", "origin", `+refs/heads/${targetBase}:refs/remotes/origin/${targetBase}`, "--quiet"]);
	run("git", ["checkout", "-B", branch, `origin/${targetBase}`]);
	// PR head fetched into FETCH_HEAD/object store only (no ref needed) — the
	// commit SHAs below just need to be resolvable objects for cherry-pick.
	run("git", ["fetch", "origin", `pull/${prNumber}/head`, "--quiet"]);

	for (const sha of commitShas) {
		// -S signs each cherry-picked commit with the configured user.signingkey.
		// The caller has already verified (checkCherryPickPrereqs) that a signing
		// key + commit.gpgsign are configured, so -S can't fail for lack of a key;
		// signing here is what keeps the redirected commit mergeable under the
		// branch's required-signatures rule (issue #257).
		const result = runCapturing("git", ["cherry-pick", "-x", "-S", sha]);
		if (!result.ok) {
			runCapturing("git", ["cherry-pick", "--abort"]);
			return { ok: false, reason: `cherry-pick of ${sha.slice(0, 7)} failed: ${result.stderr.trim() || result.stdout.trim()}` };
		}
	}

	const headSha = run("git", ["rev-parse", "HEAD"]);
	// Defence in depth: never push an UNSIGNED commit onto the hotfix lane — it
	// would be silently rejected by required-signatures with no failing check to
	// explain why (the exact failure mode of issue #257). `%G?` is 'N' only when
	// the commit carries no signature at all; 'G'/'U'/'E' all mean it IS signed
	// (an own key can read as 'U' unknown-validity or 'E' can't-verify in CI,
	// which are fine — the signature exists), so we fail only on 'N'.
	const sigStatus = runCapturing("git", ["log", "-1", "--format=%G?"]).stdout.trim();
	if (sigStatus === "N") {
		throw new Error(
			`Refusing to push: cherry-picked commit ${headSha.slice(0, 7)} is UNSIGNED (git '%G?' = 'N') even though signing prerequisites were met. It would be blocked by the branch's required-signatures rule. Check the BOT_GPG_* secrets and the GPG-import step in workflow-hotfix-redirector.yml.`
		);
	}
	run("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
	return { ok: true, branch, headSha };
}

async function main() {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const targetBase = getInput("target-base") || "hotfixes";
	const dependabotBase = getInput("dependabot-base") || "next";
	const headPattern = compilePattern(getInput("hotfix-branch-pattern"));
	const dryRun = getBooleanInput("dry-run", false);
	const bumpTypes = (getInput("bump-types") || "patch,minor")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const mergeMethod = (getInput("merge-method") || "merge").toLowerCase();
	const requireBranchProtection = getBooleanInput("require-branch-protection", true);
	let headRef = getInput("head-ref");
	let baseRef = getInput("base-ref");
	let userType = getInput("user-type");
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const pr = await fetchPR(owner, repo, prNumber, token);
	if (!headRef) headRef = pr?.head?.ref || "";
	if (!baseRef) baseRef = pr?.base?.ref || "";
	if (!userType) userType = pr?.user?.type || "";
	const userLogin = pr?.user?.login || "";
	const prBody = pr?.body || "";

	const skip = shouldSkip({ userType, userLogin, headRef, baseRef, targetBase, headPattern, prBody, dependabotBase });
	if (skip.skip) {
		console.log(`⏭️  Skipped: ${skip.reason}`);
		setOutputs({ redirected: "false", "new-base": baseRef, skipped: "true", "skip-reason": skip.reason, "replacement-pr": "" });
		return;
	}

	if (dryRun) {
		console.log(`ℹ️  dry-run=true — would redirect PR #${prNumber} (${skip.redirectKind}) ${baseRef} → ${targetBase}, skipping.`);
		setOutputs({ redirected: "false", "new-base": targetBase, skipped: "false", "skip-reason": "dry-run", "replacement-pr": "" });
		return;
	}

	if (skip.redirectKind === "hotfix") {
		// Human-authored, branch name matches the hotfix pattern: a straight
		// base PATCH is correct here — see module docstring.
		console.log(`🔀 Redirecting PR #${prNumber} base: ${baseRef} → ${targetBase} (hotfix branch)`);
		await patchBase(owner, repo, prNumber, targetBase, token);
		if (!(await hasSentinelComment(owner, repo, prNumber, token))) {
			await postComment(owner, repo, prNumber, buildCommentBody(baseRef, targetBase, "hotfix"), token);
		}
		setOutputs({ redirected: "true", "new-base": targetBase, skipped: "false", "skip-reason": "", "replacement-pr": "" });
		return;
	}

	// redirectKind === "dependabot-security": cherry-pick onto a fresh branch
	// cut from targetBase's own tip instead of merging Dependabot's next-forked
	// branch as-is.
	console.log(`🔀 Redirecting PR #${prNumber} (Dependabot security advisory) by cherry-picking onto '${targetBase}'`);

	// Fail LOUDLY (not a silent skip) when the caller workflow can't support the
	// cherry-pick. An out-of-date caller — a copied `local-*`/example template
	// from before checkout + git-identity were required — would otherwise reach
	// `git cherry-pick` with no checkout / no identity, where the failure is
	// silent-ish: runCapturing misreads the missing identity as a conflict, posts
	// a misleading comment, and exits 0, leaving this security PR on the default
	// branch to be auto-merged. A red X + explanatory comment is the correct
	// signal — the fix is to update the caller, not to let the PR ride to master.
	const prereqReason = checkCherryPickPrereqs();
	if (prereqReason) {
		try {
			if (!(await hasSentinelComment(owner, repo, prNumber, token))) {
				await postComment(
					owner,
					repo,
					prNumber,
					`${COMMENT_SENTINEL} could NOT redirect this Dependabot security update to \`${targetBase}\` because ${prereqReason}. The workflow calling \`redirect-hotfix-pr\` is out of date: **before** this step it must run \`checkout-code\` (\`ref: ${targetBase}\`, \`fetch-depth: 0\`), \`setup-git-identity\` (with \`permission_contents: true\` on the token), and import the commit-signing key — map the \`CLDMV_BOT_GPG_PRIVATE_KEY\` / \`CLDMV_BOT_GPG_PASSPHRASE\` / \`CLDMV_BOT_NAME\` / \`CLDMV_BOT_EMAIL\` secrets so the cherry-pick is signed. This PR is still targeting \`${baseRef}\` and must NOT be auto-merged there — handle it manually and update the workflow.`,
					token
				);
			}
		} catch (commentErr) {
			console.error(`::warning::Could not post the stale-caller explanatory comment on PR #${prNumber}: ${commentErr.message}`);
		}
		setOutputs({
			redirected: "false",
			"new-base": baseRef,
			skipped: "false",
			"skip-reason": `missing-prereq: ${prereqReason}`,
			"replacement-pr": ""
		});
		throw new Error(
			`redirect-hotfix-pr needs a git checkout of the repo, a configured git identity, AND an imported commit-signing key to cherry-pick a Dependabot security update onto '${targetBase}', but ${prereqReason}. The calling workflow must run checkout-code (ref: ${targetBase}, fetch-depth: 0), setup-git-identity (with permission_contents: true on the token), and import the BOT_GPG_* signing key before this step — see local-hotfix-redirector.yml / examples/individual-repo-workflows/release-flow-v4/hotfix-redirector.yml for the current shape.`
		);
	}

	const commitShas = await fetchPrCommitShas(owner, repo, prNumber, token);
	if (commitShas.length === 0) {
		throw new Error(`PR #${prNumber} has no commits to cherry-pick — refusing to act.`);
	}

	const branch = buildReplacementBranchName(prNumber);
	const remoteUrl = buildRemoteUrl(process.env.GITHUB_REPOSITORY, token);
	console.log(`   git remote: ${redactToken(remoteUrl)}`);

	const pickResult = await cherryPickOntoBranch({ remoteUrl, targetBase, branch, prNumber, commitShas });

	if (!pickResult.ok) {
		console.log(`⚠️  ${pickResult.reason}`);
		console.log(
			"⚠️  Leaving PR on its current base — a merge would have carried unrelated history into the hotfix lane. Manual handling required."
		);
		if (!(await hasSentinelComment(owner, repo, prNumber, token))) {
			await postComment(
				owner,
				repo,
				prNumber,
				`${COMMENT_SENTINEL} could NOT cherry-pick this Dependabot security update onto \`${targetBase}\` cleanly (${pickResult.reason}). Left targeting \`${baseRef}\` rather than merging as-is, which would have carried unrelated \`next\` history into the hotfix lane. Please handle manually — rebase onto \`${targetBase}\` by hand or wait for \`${targetBase}\` to catch up.`,
				token
			);
		}
		setOutputs({
			redirected: "false",
			"new-base": baseRef,
			skipped: "false",
			"skip-reason": `cherry-pick-conflict: ${pickResult.reason}`,
			"replacement-pr": ""
		});
		return;
	}

	const labels = (pr.labels || []).map((l) => (typeof l === "string" ? l : l.name)).filter(Boolean);
	const newPr = await createPR(
		owner,
		repo,
		{
			title: pr.title,
			head: pickResult.branch,
			base: targetBase,
			body: buildReplacementPrBody(prNumber, pr.body, targetBase)
		},
		token
	);
	await addLabels(owner, repo, newPr.number, labels, token);

	await postComment(owner, repo, prNumber, buildSupersededCommentBody(newPr.number, targetBase), token);
	await closePR(owner, repo, prNumber, token);

	console.log(`✅ Opened replacement PR #${newPr.number} (${pickResult.branch} → ${targetBase}), closed #${prNumber}`);

	try {
		const result = await approveAndEnableAutoMerge({
			token,
			owner,
			repo,
			prNumber: newPr.number,
			prTitle: newPr.title,
			prNodeId: newPr.node_id,
			headSha: pickResult.headSha,
			baseRef: targetBase,
			bumpTypes,
			mergeMethod,
			requireBranchProtection
		});
		if (result.outcome === "skipped") {
			console.log(`ℹ️  ${result.reason} — replacement PR #${newPr.number} left for manual merge.`);
		} else {
			console.log(`🚀 ${result.outcome} on replacement PR #${newPr.number} (${result.mergeMethod})`);
		}
	} catch (autoMergeError) {
		// The redirect itself succeeded (replacement PR is open, clean, and
		// correctly based on hotfixes) even if auto-merge couldn't be enabled —
		// surface it loudly but don't undo the redirect.
		console.error(`::error::Replacement PR #${newPr.number} opened, but auto-merge could not be enabled: ${autoMergeError.message}`);
	}

	setOutputs({ redirected: "true", "new-base": targetBase, skipped: "false", "skip-reason": "", "replacement-pr": String(newPr.number) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
