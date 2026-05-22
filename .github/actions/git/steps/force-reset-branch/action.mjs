/**
 * @fileoverview Force-reset a branch via `git push --force-with-lease`, with
 * bounded retry on lease failure. Used by §6.3 / §7 of the v4 design
 * (docs/conventions/release-flow-v4.md) to keep next/hotfix in sync with
 * master HEAD after release merges.
 *
 * Pure helpers are exported for test.mjs; the side-effecting main is gated
 * to script entry.
 *
 * @module @cldmv/.github.git.steps.force-reset-branch
 */

import { execSync } from "node:child_process";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

/**
 * Build the argv for the force-push command. Kept pure so the test can
 * verify shape without invoking git.
 *
 * Uses an EXPLICIT lease (`--force-with-lease=<ref>:<sha>`). A bare
 * `--force-with-lease` derives its expected value from the remote-tracking
 * ref, which doesn't exist when pushing to an x-access-token URL — git then
 * reports "stale info" and refuses. Passing the SHA we just read from
 * `git ls-remote` makes the lease deterministic. An empty `expectedSha`
 * yields `…:<ref>:` (the ref must not exist yet — creating a new branch).
 *
 * @public
 * @param {object} args
 * @param {string} args.remote
 * @param {string} args.sourceRef
 * @param {string} args.targetBranch
 * @param {string} [args.expectedSha] - Current remote SHA of the target.
 * @returns {string[]} argv for execFile/spawn (or join(' ') for execSync)
 */
export function buildPushArgs({ remote, sourceRef, targetBranch, expectedSha }) {
	const lease = `--force-with-lease=refs/heads/${targetBranch}:${expectedSha || ""}`;
	return ["push", remote, `${sourceRef}:refs/heads/${targetBranch}`, lease];
}

/**
 * Decide whether a captured stderr looks like a `--force-with-lease`
 * rejection (vs. a different failure mode). Retrying only makes sense for
 * lease failures — auth errors, missing refs, etc. should propagate.
 *
 * The phrases below come from git's actual reject messages; both English
 * variants are matched.
 *
 * @public
 * @param {string} stderr
 * @returns {boolean}
 */
export function isLeaseFailure(stderr) {
	if (typeof stderr !== "string") return false;
	return /stale info|rejected.*force-with-lease|fetch first/i.test(stderr);
}

/**
 * Build an authenticated push URL for a given repo + token. Used so the
 * force-push is attributed to the token's identity (the CLDMV bot), which is
 * required when the target branch's ruleset only grants force-push bypass to
 * the bot. Mirrors the x-access-token pattern used elsewhere in this repo
 * (e.g. coverage/steps/push-badge).
 *
 * @public
 * @param {string} repository - "owner/repo"
 * @param {string} token
 * @returns {string}
 */
export function buildRemoteUrl(repository, token) {
	return `https://x-access-token:${token}@github.com/${repository}.git`;
}

/**
 * Redact an x-access-token URL so the token never reaches the log. Replaces
 * the credential portion with ***.
 *
 * @public
 * @param {string} cmd
 * @returns {string}
 */
export function redactToken(cmd) {
	if (typeof cmd !== "string") return cmd;
	return cmd.replace(/x-access-token:[^@]+@/g, "x-access-token:***@");
}

/**
 * Parse the `<sha>\t<ref>` line(s) emitted by `git ls-remote` and return the
 * SHA matching the given ref (full or short). Returns "" when not found.
 *
 * @public
 * @param {string} lsRemoteOutput
 * @param {string} ref - e.g. "refs/heads/next" or "next"
 * @returns {string}
 */
export function parseLsRemoteSha(lsRemoteOutput, ref) {
	if (typeof lsRemoteOutput !== "string" || !ref) return "";
	const target = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
	for (const line of lsRemoteOutput.split("\n")) {
		const [sha, refName] = line.split("\t").map((s) => s?.trim());
		if (refName === target) return sha || "";
	}
	return "";
}

// ---- side-effecting main flow (gated to script entry only) ----------------

function run(cmd) {
	return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runCapturingStderr(cmd) {
	try {
		const stdout = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { ok: true, stdout, stderr: "" };
	} catch (e) {
		return { ok: false, stdout: e.stdout?.toString() || "", stderr: e.stderr?.toString() || e.message };
	}
}

/** Read the target branch's current remote SHA via ls-remote ("" if absent/error). */
function remoteSha(remote, targetBranch) {
	try {
		return parseLsRemoteSha(run(`git ls-remote ${remote} refs/heads/${targetBranch}`), targetBranch);
	} catch {
		return "";
	}
}

async function main() {
	const targetBranch = getInput("target-branch", { required: true });
	const sourceRef = getInput("source-ref") || "master";
	const maxRetries = Math.max(0, parseInt(getInput("max-retries") || "1", 10) || 0);
	const token = process.env.GITHUB_TOKEN || getInput("github-token");
	const repository = getInput("repository") || process.env.GITHUB_REPOSITORY || "";

	// When a token is supplied, push/ls-remote against an x-access-token URL so
	// the operations are attributed to the bot (needed to bypass the target
	// branch's non_fast_forward rule). Otherwise use the plain remote.
	const remote = token && repository ? buildRemoteUrl(repository, token) : getInput("remote") || "origin";

	// Read the current remote SHA up front for the explicit lease. (A bare
	// --force-with-lease can't resolve a remote-tracking ref for a URL push.)
	let expectedSha = remoteSha(remote, targetBranch);

	let attempts = 0;
	let result;
	while (true) {
		const pushCmd = `git ${buildPushArgs({ remote, sourceRef, targetBranch, expectedSha }).join(" ")}`;
		console.log(`▶️  ${redactToken(pushCmd)}`);
		result = runCapturingStderr(pushCmd);
		if (result.ok) break;
		if (attempts >= maxRetries || !isLeaseFailure(result.stderr)) break;
		attempts++;
		console.log(`⚠️  Lease failure on attempt ${attempts} — the target moved; re-reading its SHA and retrying…`);
		console.log(redactToken(result.stderr.trim()));
		expectedSha = remoteSha(remote, targetBranch);
	}

	if (!result.ok) {
		console.error(`::error::Force-reset of '${targetBranch}' failed after ${attempts} retry attempt(s)`);
		console.error(redactToken(result.stderr.trim()));
		process.exit(1);
	}

	const resetSha = remoteSha(remote, targetBranch);
	console.log(`✅ Force-reset complete. ${targetBranch} → ${resetSha || "(could not verify SHA)"}`);
	setOutputs({ "reset-sha": resetSha, "retries-used": String(attempts) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
