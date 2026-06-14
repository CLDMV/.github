/**
 * @fileoverview Force-reset a branch to a source ref. Used by §6.3 / §7 of the
 * v4 design (docs/conventions/release-flow-v4.md) to keep next/hotfixes in sync
 * with master HEAD after release merges.
 *
 * PRIMARY path is the REST Git Refs API (`PATCH /git/refs/heads/<branch>` with
 * `force: true`). A raw `git push` authenticated as the bot App is rejected on
 * a require-PR / block-force-push ruleset with GH013 ("Changes must be made
 * through a pull request") even when the App is in the bypass list — GitHub
 * does not honor the App's bypass on the git path the way it does on the API
 * path. This mirrors merge-master-into-branch, which mutates the protected
 * `next` branch via the Merges API for the same reason.
 *
 * FALLBACK path is the original `git push --force-with-lease` (kept so we don't
 * regress any case where the asymmetry runs the other way, and so the action
 * still works with ambient git credentials when no token is supplied).
 *
 * Pure helpers are exported for test.mjs; the side-effecting main is gated to
 * script entry.
 *
 * @module @cldmv/.github.git.steps.force-reset-branch
 */

import { execFileSync } from "node:child_process";
import { getInput, setOutputs } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";

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

/**
 * True if the string is a full 40-char hex SHA. Lets the API path skip the
 * source-ref lookup when a SHA is passed directly.
 *
 * @public
 * @param {string} s
 * @returns {boolean}
 */
export function isFullSha(s) {
	return typeof s === "string" && /^[0-9a-f]{40}$/i.test(s);
}

/**
 * Body for `PATCH /repos/{o}/{r}/git/refs/heads/{branch}` — a force ref update
 * (the API analog of a force-push).
 *
 * @public
 * @param {string} sha
 * @returns {{ sha: string, force: true }}
 */
export function buildRefUpdatePayload(sha) {
	return { sha, force: true };
}

/**
 * Body for `POST /repos/{o}/{r}/git/refs` — create the branch when the target
 * ref doesn't exist yet (PATCH 404s in that case).
 *
 * @public
 * @param {string} targetBranch
 * @param {string} sha
 * @returns {{ ref: string, sha: string }}
 */
export function buildRefCreatePayload(targetBranch, sha) {
	return { ref: `refs/heads/${targetBranch}`, sha };
}

/**
 * Pull `.object.sha` out of a `GET /git/ref/...` (or PATCH/POST refs) response.
 *
 * @public
 * @param {object} obj
 * @returns {string}
 */
export function parseRefObjectSha(obj) {
	return obj?.object?.sha || "";
}

/**
 * Classify an api() error message as "the ref does not exist" so the API path
 * can switch from PATCH (update) to POST (create). api() throws
 * `"<METHOD> <path> -> <status>: <body>"`.
 *
 * @public
 * @param {string} message
 * @returns {boolean}
 */
export function isRefNotFound(message) {
	if (typeof message !== "string") return false;
	return /->\s*404\b/.test(message) || /not found/i.test(message);
}

// ---- side-effecting main flow (gated to script entry only) ----------------

function run(file, args) {
	return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runCapturingStderr(file, args) {
	try {
		const stdout = execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { ok: true, stdout, stderr: "" };
	} catch (e) {
		return { ok: false, stdout: e.stdout?.toString() || "", stderr: e.stderr?.toString() || e.message };
	}
}

/** Read the target branch's current remote SHA via ls-remote ("" if absent/error). */
function remoteSha(remote, targetBranch) {
	try {
		return parseLsRemoteSha(run("git", ["ls-remote", remote, `refs/heads/${targetBranch}`]), targetBranch);
	} catch {
		return "";
	}
}

/** Resolve the source ref to a SHA via the API (or pass through a full SHA). */
async function resolveSourceSha({ sourceRef, ctx }) {
	if (isFullSha(sourceRef)) return sourceRef;
	// GET a single ref uses the SINGULAR `git/ref/` path.
	const obj = await api("GET", `/git/ref/heads/${sourceRef}`, null, ctx);
	const sha = parseRefObjectSha(obj);
	if (!sha) throw new Error(`Could not resolve source ref '${sourceRef}' to a SHA`);
	return sha;
}

/**
 * Force-reset the target ref to `sha` via the REST API. PATCH (update) first;
 * if the ref doesn't exist yet, POST (create). Returns {ok, sha, error}.
 */
async function apiForceReset({ targetBranch, sha, ctx }) {
	try {
		// Update an existing ref uses the PLURAL `git/refs/` path.
		const r = await api("PATCH", `/git/refs/heads/${targetBranch}`, buildRefUpdatePayload(sha), ctx);
		return { ok: true, sha: parseRefObjectSha(r) || sha, error: "" };
	} catch (ePatch) {
		if (isRefNotFound(ePatch.message)) {
			try {
				const r = await api("POST", `/git/refs`, buildRefCreatePayload(targetBranch, sha), ctx);
				return { ok: true, sha: parseRefObjectSha(r) || sha, error: "" };
			} catch (ePost) {
				return { ok: false, sha: "", error: ePost.message };
			}
		}
		return { ok: false, sha: "", error: ePatch.message };
	}
}

/** Original CLI path: `git push --force-with-lease`, bounded retry on lease failure. */
function cliForceReset({ targetBranch, sourceRef, token, repository, maxRetries }) {
	const remote = token && repository ? buildRemoteUrl(repository, token) : getInput("remote") || "origin";
	let expectedSha = remoteSha(remote, targetBranch);

	let attempts = 0;
	let result;
	while (true) {
		const pushArgs = buildPushArgs({ remote, sourceRef, targetBranch, expectedSha });
		console.log(`▶️  ${redactToken(`git ${pushArgs.join(" ")}`)}`);
		result = runCapturingStderr("git", pushArgs);
		if (result.ok) break;
		if (attempts >= maxRetries || !isLeaseFailure(result.stderr)) break;
		attempts++;
		console.log(`⚠️  Lease failure on attempt ${attempts} — the target moved; re-reading its SHA and retrying…`);
		console.log(redactToken(result.stderr.trim()));
		expectedSha = remoteSha(remote, targetBranch);
	}

	return { ok: result.ok, resetSha: result.ok ? remoteSha(remote, targetBranch) : "", stderr: result.stderr, retries: attempts };
}

async function main() {
	const targetBranch = getInput("target-branch", { required: true });
	const sourceRef = getInput("source-ref") || "master";
	const maxRetries = Math.max(0, parseInt(getInput("max-retries") || "1", 10) || 0);
	const token = process.env.GITHUB_TOKEN || getInput("github-token");
	const repository = getInput("repository") || process.env.GITHUB_REPOSITORY || "";

	let method = "";
	let resetSha = "";

	// ---- PRIMARY: REST Git Refs API (honors the bot App's ruleset bypass) ----
	if (token && repository) {
		try {
			const { owner, repo } = parseRepo(repository);
			const ctx = { token, owner, repo };
			const sourceSha = await resolveSourceSha({ sourceRef, ctx });
			console.log(`▶️  PATCH /repos/${owner}/${repo}/git/refs/heads/${targetBranch} { sha: ${sourceSha.slice(0, 7)}…, force: true }`);
			const apiResult = await apiForceReset({ targetBranch, sha: sourceSha, ctx });
			if (apiResult.ok) {
				method = "api";
				resetSha = apiResult.sha;
			} else {
				console.log(`⚠️  API ref-update failed — falling back to CLI push.`);
				console.log(redactToken(apiResult.error));
			}
		} catch (e) {
			console.log(`⚠️  API ref-update threw — falling back to CLI push.`);
			console.log(redactToken(e.message));
		}
	}

	// ---- FALLBACK: git push --force-with-lease ----
	if (!method) {
		const cli = cliForceReset({ targetBranch, sourceRef, token, repository, maxRetries });
		if (!cli.ok) {
			console.error(`::error::Force-reset of '${targetBranch}' failed (API primary + CLI fallback both failed).`);
			console.error(redactToken(cli.stderr.trim()));
			process.exit(1);
		}
		method = "cli";
		resetSha = cli.resetSha;
		setOutputs({ "reset-sha": resetSha, "retries-used": String(cli.retries), method });
		console.log(`✅ Force-reset complete via CLI. ${targetBranch} → ${resetSha || "(could not verify SHA)"}`);
		return;
	}

	setOutputs({ "reset-sha": resetSha, "retries-used": "0", method });
	console.log(`✅ Force-reset complete via API. ${targetBranch} → ${resetSha || "(could not verify SHA)"}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
