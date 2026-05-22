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
 * @public
 * @param {object} args
 * @param {string} args.remote
 * @param {string} args.sourceRef
 * @param {string} args.targetBranch
 * @returns {string[]} argv for execFile/spawn (or join(' ') for execSync)
 */
export function buildPushArgs({ remote, sourceRef, targetBranch }) {
	return ["push", remote, `${sourceRef}:refs/heads/${targetBranch}`, "--force-with-lease"];
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

async function main() {
	const targetBranch = getInput("target-branch", { required: true });
	const sourceRef = getInput("source-ref") || "master";
	const maxRetries = Math.max(0, parseInt(getInput("max-retries") || "1", 10) || 0);
	const token = process.env.GITHUB_TOKEN || getInput("github-token");
	const repository = getInput("repository") || process.env.GITHUB_REPOSITORY || "";

	// When a token is supplied, push/fetch/ls-remote against an x-access-token
	// URL so the operations are attributed to the bot (needed to bypass the
	// target branch's non_fast_forward rule). Otherwise use the plain remote.
	const remote = token && repository ? buildRemoteUrl(repository, token) : getInput("remote") || "origin";

	const pushArgs = buildPushArgs({ remote, sourceRef, targetBranch });
	const pushCmd = `git ${pushArgs.join(" ")}`;
	console.log(`▶️  ${redactToken(pushCmd)}`);

	let attempts = 0;
	let result = runCapturingStderr(pushCmd);

	while (!result.ok && attempts < maxRetries && isLeaseFailure(result.stderr)) {
		attempts++;
		console.log(`⚠️  Lease failure on attempt ${attempts}:`);
		console.log(redactToken(result.stderr.trim()));
		console.log(`🔄 Re-fetching ${targetBranch} and retrying…`);
		try {
			run(`git fetch ${remote} ${targetBranch} --quiet`);
		} catch (e) {
			// Fetch failure is reported but doesn't preempt the retry — push will
			// fail again with a clearer message if it's genuinely broken.
			console.log(`(non-fatal) git fetch failed: ${redactToken(e.message)}`);
		}
		result = runCapturingStderr(pushCmd);
	}

	if (!result.ok) {
		console.error(`::error::Force-reset of '${targetBranch}' failed after ${attempts} retry attempt(s)`);
		console.error(redactToken(result.stderr.trim()));
		process.exit(1);
	}

	// Read back the new remote SHA so the caller has it for summary/output.
	const lsOut = run(`git ls-remote ${remote} refs/heads/${targetBranch}`);
	const resetSha = parseLsRemoteSha(lsOut, targetBranch);

	console.log(`✅ Force-reset complete. ${targetBranch} → ${resetSha || "(could not verify SHA)"}`);
	setOutputs({ "reset-sha": resetSha, "retries-used": String(attempts) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
