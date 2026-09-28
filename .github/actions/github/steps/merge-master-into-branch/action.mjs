/**
 * @fileoverview Merge a source ref into a target branch via the GitHub
 * Merges API. Implements §7.2 of the v4 design — after a hotfix lands on
 * master, run this to preserve accumulated feature work on `next`.
 *
 * Why the API and not a `git push`: a push authenticated as the bot App is
 * rejected by a protected branch's ruleset (GH013 "Changes must be made
 * through a pull request") even when the App is in the bypass list with mode
 * Always — GitHub honors an App's ruleset bypass on the REST API path but not
 * on raw git. force-reset-branch hit the same wall and switched to the Git
 * Refs API for exactly this reason.
 *
 * Version-only conflict fallback (#334): when `next` has a pending release,
 * next-release has bumped next's package.json / package-lock.json version
 * (e.g. 0.4.0) while the hotfix release bumped master's (e.g. 0.3.3). Both
 * sides changed the same `"version"` lines, so the Merges API answers 409 on
 * every hotfix released while a next release is pending. On a 409 this action
 * re-does the merge locally (`git merge-tree`, no working-tree changes) and,
 * when EVERY conflict is one of those version fields — root `version` in
 * package.json, root `version` + `packages[""].version` in package-lock.json —
 * keeps the TARGET branch's side (next-release recomputes the pending version
 * from master anyway). The resolved two-parent merge commit is then published
 * through the Git Data API (blobs → tree → commit → fast-forward ref update),
 * so it is signed by GitHub for the bot App exactly like the Merges API's own
 * merge commit, and the ruleset bypass still applies. Any other conflict
 * fails loudly, as before.
 *
 * Pure helpers are exported for test.mjs; side-effecting main is gated to
 * script entry.
 *
 * @module @cldmv/.github.github.steps.merge-master-into-branch
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { api, parseRepo } from "../../api/_api/core.mjs";
import { getInput, setOutputs, getBooleanInput } from "../../../common/common/core.mjs";

/**
 * Build the JSON body for `POST /repos/{owner}/{repo}/merges`.
 *
 * @public
 * @param {object} args
 * @param {string} args.targetBranch
 * @param {string} args.sourceRef
 * @param {string} [args.commitMessage] - Override commit message.
 * @returns {{ base: string, head: string, commit_message: string }}
 */
export function buildMergePayload({ targetBranch, sourceRef, commitMessage }) {
	const message = commitMessage && commitMessage.trim() ? commitMessage.trim() : `Merge ${sourceRef} into ${targetBranch}`;
	return { base: targetBranch, head: sourceRef, commit_message: message };
}

/**
 * Interpret a Merges API response. GitHub defines three relevant outcomes:
 *   - 201 Created: merge happened; body has { sha, ... }
 *   - 204 No Content: nothing to merge (already up-to-date)
 *   - 409 Conflict: merge conflict; we treat this as a failure
 *
 * 4xx outcomes other than 409 (404 missing branch, 422 bad ref, etc.) are
 * reported as failures with the original status preserved.
 *
 * @public
 * @param {number} status - HTTP status code.
 * @param {object|null} body - Parsed JSON body (null on 204).
 * @returns {{ performed: boolean, sha: string, conflict: boolean, error: string }}
 */
export function interpretMergeResponse(status, body) {
	if (status === 201) {
		return { performed: true, sha: body?.sha || "", conflict: false, error: "" };
	}
	if (status === 204) {
		return { performed: false, sha: "", conflict: false, error: "" };
	}
	if (status === 409) {
		return { performed: false, sha: "", conflict: true, error: "Merge conflict (409) — manual resolution required" };
	}
	const detail = body && typeof body === "object" ? JSON.stringify(body) : String(body || "");
	return { performed: false, sha: "", conflict: false, error: `Unexpected status ${status}: ${detail}` };
}

// ---- version-only conflict fallback: pure helpers ---------------------------

/**
 * Files whose conflicts the local fallback may auto-resolve, mapped to the
 * JSON paths allowed to differ between the two sides. These are exactly the
 * fields a release version bump rewrites: `npm version` updates package.json's
 * root `version` and, in package-lock.json, the root `version` plus
 * `packages[""].version`. (`pnpm version` / `yarn version` touch only
 * package.json — their lockfiles do not record the root version.) Only the
 * repository-root files are listed; the release bump never touches others.
 *
 * @public
 * @type {Readonly<Record<string, ReadonlyArray<ReadonlyArray<string>>>>}
 */
export const VERSION_FIELD_PATHS = Object.freeze({
	"package.json": [["version"]],
	"package-lock.json": [["version"], ["packages", "", "version"]]
});

/**
 * Parse `git merge-tree --write-tree -z --messages` output.
 *
 * Layout: `<tree>\0`, then one `<mode> <oid> <stage>\t<path>\0` entry per
 * conflicted stage, an empty field, then messages as
 * `<N>\0<path_1>\0…<path_N>\0<type>\0<message>\0`.
 *
 * @public
 * @param {string} raw - stdout of the merge-tree call.
 * @returns {{ tree: string, entries: Array<{ mode: string, oid: string, stage: number, path: string }>, messages: Array<{ paths: string[], type: string, message: string }> }}
 */
export function parseMergeTreeOutput(raw) {
	const fields = String(raw || "").split("\0");
	const tree = fields[0] || "";
	const entries = [];
	let i = 1;
	for (; i < fields.length && fields[i] !== ""; i++) {
		const tab = fields[i].indexOf("\t");
		const [mode, oid, stage] = fields[i].slice(0, tab).split(" ");
		entries.push({ mode, oid, stage: Number(stage), path: fields[i].slice(tab + 1) });
	}
	i++; // the empty field that ends the conflicted-file section
	const messages = [];
	while (i < fields.length && /^\d+$/.test(fields[i])) {
		const n = Number(fields[i++]);
		const paths = fields.slice(i, i + n);
		i += n;
		const type = fields[i++] || "";
		const message = (fields[i++] || "").trim();
		messages.push({ paths, type, message });
	}
	return { tree, entries, messages };
}

/**
 * Resolve every conflict hunk in a file's merged text by taking one side.
 * Understands the `merge` and `diff3`/`zdiff3` marker styles (a `|||||||`
 * base section is dropped). Returns null when the markers are malformed —
 * an unterminated hunk, or a stray `=======` / `>>>>>>>` — so the caller can
 * refuse rather than guess.
 *
 * @public
 * @param {string} text - File content containing conflict markers.
 * @param {"ours"|"theirs"} side - "ours" = the merge's first branch (the target).
 * @returns {{ text: string, hunks: number } | null}
 */
export function resolveConflictMarkers(text, side) {
	const lines = String(text).split("\n");
	const out = [];
	let state = "clean"; // clean | ours | base | theirs
	let hunks = 0;
	for (const line of lines) {
		if (line.startsWith("<<<<<<<")) {
			if (state !== "clean") return null;
			state = "ours";
			hunks++;
		} else if (line.startsWith("|||||||") && state === "ours") {
			state = "base";
		} else if (line.startsWith("=======") && (state === "ours" || state === "base")) {
			state = "theirs";
		} else if (line.startsWith(">>>>>>>")) {
			if (state !== "theirs") return null;
			state = "clean";
		} else if (state === "clean" && (line.startsWith("=======") || line.startsWith("|||||||"))) {
			return null;
		} else if (state === "clean" || state === side) {
			out.push(line);
		}
	}
	if (state !== "clean") return null;
	return { text: out.join("\n"), hunks };
}

/**
 * List the JSON paths at which two parsed documents differ (added, removed,
 * or changed leaves). Arrays are compared element by element.
 *
 * @public
 * @param {unknown} a
 * @param {unknown} b
 * @param {string[]} [prefix]
 * @returns {string[][]}
 */
export function diffJsonPaths(a, b, prefix = []) {
	const isObj = (v) => v !== null && typeof v === "object";
	if (!isObj(a) || !isObj(b) || Array.isArray(a) !== Array.isArray(b)) {
		return Object.is(a, b) ? [] : [prefix];
	}
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	const diffs = [];
	for (const key of keys) {
		if (!(key in a) || !(key in b)) {
			diffs.push([...prefix, key]);
			continue;
		}
		diffs.push(...diffJsonPaths(a[key], b[key], [...prefix, key]));
	}
	return diffs;
}

/**
 * Read a nested value by path; undefined when any segment is missing.
 *
 * @param {unknown} obj
 * @param {ReadonlyArray<string>} path
 * @returns {unknown}
 */
function getPath(obj, path) {
	return path.reduce((cur, key) => (cur !== null && typeof cur === "object" ? cur[key] : undefined), obj);
}

/**
 * Decide whether one conflicted file is safe to auto-resolve, and resolve it.
 *
 * Safe means: the path is a known version file (VERSION_FIELD_PATHS), its
 * markers parse, both one-sided resolutions are valid JSON, and those two
 * documents differ ONLY at that file's version paths. Comparing the parsed
 * documents (rather than pattern-matching the conflicted lines) is what keeps
 * a conflicting `"version"` of some nested lockfile dependency — or any other
 * field — from slipping through. The result keeps the target's ("ours") side.
 *
 * @public
 * @param {string} path - Repo-relative path of the conflicted file.
 * @param {string} conflictedText - The file's merged content, with markers.
 * @returns {{ ok: true, resolvedText: string, fields: Array<{ path: string, target: unknown, source: unknown }> } | { ok: false, reason: string }}
 */
export function analyzeVersionConflict(path, conflictedText) {
	const allowed = VERSION_FIELD_PATHS[path];
	if (!allowed) return { ok: false, reason: `${path}: not a package.json / package-lock.json version file` };

	const ours = resolveConflictMarkers(conflictedText, "ours");
	const theirs = resolveConflictMarkers(conflictedText, "theirs");
	if (!ours || !theirs) return { ok: false, reason: `${path}: conflict markers could not be parsed` };
	if (ours.hunks === 0) return { ok: false, reason: `${path}: reported as conflicted but has no conflict hunks` };

	let oursJson;
	let theirsJson;
	try {
		oursJson = JSON.parse(ours.text);
		theirsJson = JSON.parse(theirs.text);
	} catch (e) {
		return { ok: false, reason: `${path}: a one-sided resolution is not valid JSON (${e.message})` };
	}

	const allowedKeys = new Set(allowed.map((p) => JSON.stringify(p)));
	const disallowed = diffJsonPaths(oursJson, theirsJson).filter((p) => !allowedKeys.has(JSON.stringify(p)));
	if (disallowed.length > 0) {
		const shown = disallowed.slice(0, 5).map((p) => p.map((k) => JSON.stringify(k)).join("."));
		return { ok: false, reason: `${path}: conflict touches non-version field(s) ${shown.join(", ")}` };
	}

	const fields = allowed
		.map((p) => ({ path: p.map((k) => JSON.stringify(k)).join("."), target: getPath(oursJson, p), source: getPath(theirsJson, p) }))
		.filter((f) => f.target !== f.source);
	return { ok: true, resolvedText: ours.text, fields };
}

/**
 * Decide, from a parsed merge-tree result, whether EVERY conflict is a
 * version-only conflict. Checks the conflict types first (only plain content
 * conflicts qualify — no modify/delete, rename, add/add, binary, …), then each
 * conflicted path's stages (base, target and source must all be regular
 * files), then its content via analyzeVersionConflict.
 *
 * @public
 * @param {ReturnType<typeof parseMergeTreeOutput>} parsed
 * @param {(path: string) => string} readConflicted - Returns the conflicted file's merged text.
 * @returns {{ ok: true, resolutions: Array<{ path: string, resolvedText: string, fields: Array<{ path: string, target: unknown, source: unknown }> }> } | { ok: false, reason: string }}
 */
export function planVersionOnlyResolution(parsed, readConflicted) {
	const badTypes = parsed.messages.filter((m) => m.type.startsWith("CONFLICT") && m.type !== "CONFLICT (contents)");
	if (badTypes.length > 0) {
		return { ok: false, reason: badTypes.map((m) => `${m.paths.join(", ")}: ${m.type}`).join("; ") };
	}

	const byPath = new Map();
	for (const e of parsed.entries) {
		if (!byPath.has(e.path)) byPath.set(e.path, []);
		byPath.get(e.path).push(e);
	}

	const resolutions = [];
	const reasons = [];
	for (const [path, stages] of byPath) {
		const stageSet = stages
			.map((s) => s.stage)
			.sort()
			.join(",");
		if (stageSet !== "1,2,3" || stages.some((s) => s.mode !== "100644")) {
			reasons.push(`${path}: not a plain both-modified file conflict (stages ${stageSet})`);
			continue;
		}
		const r = analyzeVersionConflict(path, readConflicted(path));
		if (r.ok) resolutions.push({ path, resolvedText: r.resolvedText, fields: r.fields });
		else reasons.push(r.reason);
	}
	if (reasons.length > 0) return { ok: false, reason: reasons.join("; ") };
	return { ok: true, resolutions };
}

/**
 * Parse `git diff-tree -r -z --no-renames <a> <b>` raw output into tree
 * changes: `:<srcmode> <dstmode> <srcoid> <dstoid> <status>\0<path>\0`.
 *
 * @public
 * @param {string} raw
 * @returns {Array<{ srcMode: string, dstMode: string, dstOid: string, status: string, path: string }>}
 */
export function parseDiffTreeRaw(raw) {
	const fields = String(raw || "").split("\0");
	const changes = [];
	for (let i = 0; i + 1 < fields.length; i += 2) {
		const meta = fields[i];
		if (!meta.startsWith(":")) break;
		const [srcMode, dstMode, , dstOid, status] = meta.slice(1).split(" ");
		changes.push({ srcMode, dstMode, dstOid, status, path: fields[i + 1] });
	}
	return changes;
}

/**
 * Turn tree changes (target tree → resolved merge tree) into
 * `POST /git/trees` items. A deletion becomes `sha: null`; a gitlink keeps its
 * commit SHA. A blob the remote already has (it exists in the source commit's
 * tree) is referenced by SHA; any other blob — a resolved version file or an
 * auto-merged file — is flagged `upload: true` for `POST /git/blobs` first.
 *
 * @public
 * @param {ReturnType<typeof parseDiffTreeRaw>} changes
 * @param {Set<string>} remoteBlobs - Blob SHAs known to exist on the remote.
 * @returns {Array<{ path: string, mode: string, type: string, sha: string|null, upload: boolean }>}
 */
export function buildTreeItems(changes, remoteBlobs) {
	return changes.map((c) => {
		if (c.status === "D") return { path: c.path, mode: c.srcMode, type: "blob", sha: null, upload: false };
		const type = c.dstMode === "160000" ? "commit" : "blob";
		const upload = type === "blob" && !remoteBlobs.has(c.dstOid);
		return { path: c.path, mode: c.dstMode, type, sha: c.dstOid, upload };
	});
}

/**
 * Commit message for a fallback merge: the normal merge message plus a body
 * recording which version fields were resolved to the target's side.
 *
 * @public
 * @param {string} baseMessage - buildMergePayload(...).commit_message.
 * @param {string} targetBranch
 * @param {Array<{ path: string, fields: Array<{ path: string, target: unknown, source: unknown }> }>} resolutions
 * @returns {string}
 */
export function buildFallbackCommitMessage(baseMessage, targetBranch, resolutions) {
	const lines = [];
	for (const r of resolutions) {
		for (const f of r.fields)
			lines.push(`- ${r.path} ${f.path}: kept ${JSON.stringify(f.target)} (source had ${JSON.stringify(f.source)})`);
	}
	if (lines.length === 0) return baseMessage;
	return `${baseMessage}\n\nVersion-only conflicts resolved with ${targetBranch}'s side:\n${lines.join("\n")}`;
}

/**
 * Run the Merges API call and, on a 409, the local fallback. 201/204 and
 * every non-409 failure are returned exactly as interpretMergeResponse
 * reports them; the fallback never runs for those.
 *
 * @public
 * @param {object} args
 * @param {() => Promise<{ status: number, body: object|null }>} args.merge - The Merges API call.
 * @param {() => Promise<{ ok: boolean, sha?: string, reason?: string }>} args.fallback - Local version-only fallback.
 * @returns {Promise<{ performed: boolean, sha: string, conflict: boolean, resolved: boolean, error: string }>}
 */
export async function mergeWithFallback({ merge, fallback }) {
	const { status, body } = await merge();
	const result = { ...interpretMergeResponse(status, body), resolved: false };
	if (!result.conflict) return result;

	let fb;
	try {
		fb = await fallback();
	} catch (e) {
		fb = { ok: false, reason: e.message };
	}
	if (fb.ok) return { performed: true, sha: fb.sha || "", conflict: true, resolved: true, error: "" };
	return { ...result, error: `${result.error}. Local fallback declined: ${fb.reason}` };
}

// ---- version-only conflict fallback: git + API side effects ------------------

/**
 * Run git in `cwd`; returns { status, stdout, stderr }. Never throws.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @param {{ input?: string, env?: Record<string, string> }} [opts]
 * @returns {{ status: number|null, stdout: string, stderr: string }}
 */
function git(cwd, args, { input, env } = {}) {
	const r = spawnSync("git", args, {
		cwd,
		input,
		encoding: "utf8",
		maxBuffer: 1024 * 1024 * 256,
		env: { ...process.env, ...env }
	});
	return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || r.error?.message || "" };
}

/** Read a blob's exact text (untrimmed); throws when it can't be read. */
function readBlob(cwd, spec) {
	const r = git(cwd, ["cat-file", "blob", spec]);
	if (r.status !== 0) throw new Error(`git cat-file blob ${spec} failed: ${r.stderr.trim()}`);
	return r.stdout;
}

/** Like git(), but throws with stderr on a non-zero exit and returns trimmed stdout. */
function gitOk(cwd, args, opts) {
	const r = git(cwd, args, opts);
	if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.trim() || `exit ${r.status}`}`);
	return r.stdout.trim();
}

/**
 * Merge `sourceSha` into `targetSha` locally without touching the working
 * tree or index, and — when every conflict is version-only — produce the
 * resolved tree (written to the object store).
 *
 * @public
 * @param {object} args
 * @param {string} args.cwd - A git repository containing both commits.
 * @param {string} args.targetSha - The branch receiving the merge (next).
 * @param {string} args.sourceSha - The ref being merged in (master).
 * @returns {{ ok: true, tree: string, resolutions: Array<{ path: string, fields: Array<{ path: string, target: unknown, source: unknown }> }> } | { ok: false, reason: string }}
 */
export function planLocalMerge({ cwd, targetSha, sourceSha }) {
	const mt = git(cwd, ["-c", "merge.conflictStyle=merge", "merge-tree", "--write-tree", "-z", "--messages", targetSha, sourceSha]);
	if (mt.status !== 0 && mt.status !== 1) {
		return { ok: false, reason: `git merge-tree failed (needs git >= 2.38): ${mt.stderr.trim() || `exit ${mt.status}`}` };
	}
	const parsed = parseMergeTreeOutput(mt.stdout);
	if (mt.status === 0) return { ok: true, tree: parsed.tree, resolutions: [] };

	const plan = planVersionOnlyResolution(parsed, (path) => readBlob(cwd, `${parsed.tree}:${path}`));
	if (!plan.ok) return plan;

	// Swap each conflicted blob in the merge-tree result for its resolved
	// content, via a throwaway index so the real index/work tree stay untouched.
	const indexFile = gitOk(cwd, ["rev-parse", "--absolute-git-dir"]) + `/cldmv-merge-fallback-${process.pid}.index`;
	const env = { GIT_INDEX_FILE: indexFile };
	try {
		gitOk(cwd, ["read-tree", parsed.tree], { env });
		for (const r of plan.resolutions) {
			const blob = gitOk(cwd, ["hash-object", "-w", "--stdin"], { input: r.resolvedText });
			gitOk(cwd, ["update-index", "--cacheinfo", `100644,${blob},${r.path}`], { env });
		}
		const tree = gitOk(cwd, ["write-tree"], { env });
		return { ok: true, tree, resolutions: plan.resolutions.map(({ path, fields }) => ({ path, fields })) };
	} finally {
		fs.rmSync(indexFile, { force: true });
	}
}

/**
 * Publish a planned merge through the Git Data API: upload new blobs, create
 * the tree on top of the target's tree, verify it matches the locally built
 * tree, create the two-parent commit (GitHub signs it for the App token), and
 * fast-forward the target ref (no force — a target that moved meanwhile makes
 * the update fail instead of dropping the new commit).
 *
 * @public
 * @param {object} args
 * @param {string} args.cwd
 * @param {string} args.targetBranch
 * @param {string} args.targetSha
 * @param {string} args.sourceSha
 * @param {string} args.tree - Resolved tree from planLocalMerge.
 * @param {string} args.message
 * @param {object} args.ctx - { token, owner, repo } for api().
 * @param {typeof api} [args.apiFn] - Injectable for tests.
 * @returns {Promise<string>} The new merge commit SHA.
 */
export async function publishMergeCommit({ cwd, targetBranch, targetSha, sourceSha, tree, message, ctx, apiFn = api }) {
	const targetTree = gitOk(cwd, ["rev-parse", `${targetSha}^{tree}`]);
	let remoteTree = targetTree;
	if (tree !== targetTree) {
		const remoteBlobs = new Set(
			gitOk(cwd, ["ls-tree", "-r", "-z", sourceSha])
				.split("\0")
				.filter(Boolean)
				.map((line) => line.split("\t")[0].split(" ")[2])
		);
		const changes = parseDiffTreeRaw(git(cwd, ["diff-tree", "-r", "-z", "--no-renames", targetTree, tree]).stdout);
		const items = buildTreeItems(changes, remoteBlobs);
		for (const item of items.filter((i) => i.upload)) {
			const res = await apiFn("POST", "/git/blobs", { content: blobBase64(cwd, item.sha), encoding: "base64" }, ctx);
			if (res?.sha !== item.sha) throw new Error(`Uploaded blob for ${item.path} came back as ${res?.sha}, expected ${item.sha}`);
		}
		const res = await apiFn("POST", "/git/trees", { base_tree: targetTree, tree: items.map(({ upload: _, ...rest }) => rest) }, ctx);
		remoteTree = res?.sha || "";
		if (remoteTree !== tree)
			throw new Error(`Remote tree ${remoteTree} does not match the locally resolved tree ${tree} — refusing to commit`);
	}

	const commit = await apiFn("POST", "/git/commits", { message, tree: remoteTree, parents: [targetSha, sourceSha] }, ctx);
	if (!commit?.sha) throw new Error("POST /git/commits returned no SHA");
	console.log(`🔐 Merge commit ${commit.sha} verified: ${commit.verification?.verified} (reason: ${commit.verification?.reason})`);
	await apiFn("PATCH", `/git/refs/heads/${targetBranch}`, { sha: commit.sha, force: false }, ctx);
	return commit.sha;
}

/** Read a blob's raw bytes as base64 (binary-safe). */
function blobBase64(cwd, sha) {
	const r = spawnSync("git", ["cat-file", "blob", sha], { cwd, maxBuffer: 1024 * 1024 * 256 });
	if (r.status !== 0) throw new Error(`git cat-file blob ${sha} failed: ${r.stderr?.toString().trim()}`);
	return r.stdout.toString("base64");
}

// ---- side-effecting main flow (gated to script entry only) ----------------

async function callMergesApi({ owner, repo, payload, token }) {
	const url = `https://api.github.com/repos/${owner}/${repo}/merges`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${token}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2026-03-10"
		},
		body: JSON.stringify(payload)
	});
	const status = res.status;
	const body = status === 204 ? null : await res.json().catch(() => null);
	return { status, body };
}

/**
 * The 409 fallback: fetch the current target and source tips, plan the local
 * merge, and publish it when every conflict is version-only.
 *
 * @returns {Promise<{ ok: boolean, sha?: string, reason?: string }>}
 */
async function localVersionFallback({ owner, repo, token, targetBranch, sourceRef, message }) {
	const cwd = process.env.GITHUB_WORKSPACE || process.cwd();
	if (git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() !== "true") {
		return { ok: false, reason: "no git checkout in the workspace (the calling job must check out the repository)" };
	}

	// Fetch both tips fresh through an authenticated URL, so the fallback works
	// on private repos whatever the checkout persisted. The token is never logged.
	const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
	const sourceSpec = /^[0-9a-f]{40}$/i.test(sourceRef) ? sourceRef : `+${sourceRef}:refs/cldmv-merge-fallback/source`;
	const fetchArgs = ["fetch", "--no-tags", "--quiet"];
	if (git(cwd, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true") fetchArgs.push("--unshallow");
	const fetched = git(cwd, [...fetchArgs, url, `+refs/heads/${targetBranch}:refs/cldmv-merge-fallback/target`, sourceSpec]);
	if (fetched.status !== 0) {
		return { ok: false, reason: `could not fetch ${targetBranch}/${sourceRef}: ${fetched.stderr.replaceAll(token, "***").trim()}` };
	}
	const targetSha = gitOk(cwd, ["rev-parse", "refs/cldmv-merge-fallback/target^{commit}"]);
	const sourceSha = /^[0-9a-f]{40}$/i.test(sourceRef) ? sourceRef : gitOk(cwd, ["rev-parse", "refs/cldmv-merge-fallback/source^{commit}"]);
	console.log(`🔀 Local merge: ${sourceRef} (${sourceSha.slice(0, 7)}) into ${targetBranch} (${targetSha.slice(0, 7)})`);

	const plan = planLocalMerge({ cwd, targetSha, sourceSha });
	if (!plan.ok) return plan;
	for (const r of plan.resolutions) {
		for (const f of r.fields)
			console.log(`   ${r.path} ${f.path}: keeping ${targetBranch}'s ${JSON.stringify(f.target)} over ${JSON.stringify(f.source)}`);
	}

	const sha = await publishMergeCommit({
		cwd,
		targetBranch,
		targetSha,
		sourceSha,
		tree: plan.tree,
		message: buildFallbackCommitMessage(message, targetBranch, plan.resolutions),
		ctx: { token, owner, repo }
	});
	return { ok: true, sha };
}

async function main() {
	const token = process.env.GITHUB_TOKEN || getInput("github-token", { required: true });
	const targetBranch = getInput("target-branch", { required: true });
	const sourceRef = getInput("source-ref") || "master";
	const commitMessage = getInput("commit-message");
	const dryRun = getBooleanInput("dry-run", false);
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const payload = buildMergePayload({ targetBranch, sourceRef, commitMessage });
	console.log(`▶️  POST /repos/${owner}/${repo}/merges — merging '${sourceRef}' into '${targetBranch}'`);
	console.log(`   commit_message: "${payload.commit_message}"`);

	if (dryRun) {
		console.log("ℹ️  dry-run=true — skipping API call.");
		setOutputs({ "merge-sha": "", "merge-performed": "false", "had-conflict": "false", "conflict-resolved": "false" });
		return;
	}

	const result = await mergeWithFallback({
		merge: () => callMergesApi({ owner, repo, payload, token }),
		fallback: () => {
			console.log(
				"⚠️  Merges API returned 409 — retrying locally; only version-only package.json / package-lock.json conflicts are auto-resolved."
			);
			return localVersionFallback({ owner, repo, token, targetBranch, sourceRef, message: payload.commit_message });
		}
	});

	setOutputs({
		"merge-sha": result.sha,
		"merge-performed": String(result.performed),
		"had-conflict": String(result.conflict),
		"conflict-resolved": String(result.resolved)
	});

	if (result.error) {
		console.error(`::error::${result.error}`);
		process.exit(1);
	}

	if (result.resolved) {
		console.log(`✅ Version-only conflict resolved with ${targetBranch}'s side; merge commit created: ${result.sha}`);
	} else if (result.performed) {
		console.log(`✅ Merge commit created: ${result.sha}`);
	} else {
		console.log(`ℹ️  Already up-to-date — nothing to merge.`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(`::error::${error.message}`);
		process.exit(1);
	});
}
