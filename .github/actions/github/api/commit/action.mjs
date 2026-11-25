/**
 * @fileoverview Create a signed commit via the GitHub API: build blobs and a
 * tree from the staged changes, create the commit, and move the branch ref.
 * Node entrypoint for the github/api/commit action.
 *
 * Superseded runs (CLDMV/.github#467): when two PRs merge into `next` a few
 * seconds apart, the earlier next-release run plans and builds its bump commit
 * on the old tip. The ref update is then refused with 422 "Update is not a
 * fast forward". If the branch moved forward from the commit this run started
 * from, a newer run (queued behind this one by the workflow's concurrency
 * group) owns the release, so the action reports `superseded=true` and exits
 * 0 instead of leaving a red run. Any other refusal still fails.
 * @module @cldmv/.github.github.api.commit
 */

import { execSync } from "node:child_process";
import { api, parseRepo } from "../_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

/**
 * Whether an api() error is GitHub refusing a ref update as non-fast-forward.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isNotFastForward(error) {
	const msg = String(error?.message || "");
	return /-> 422:/.test(msg) && /not a fast[ -]forward/i.test(msg);
}

/**
 * After a refused ref update, decide whether the branch moved ahead of the
 * commit this run planned from (a newer run owns it) or something else
 * happened (fail).
 *
 * @param {object} args
 * @param {string} args.branch - Branch whose ref update was refused.
 * @param {string} args.baseSha - The commit this run built its commit on.
 * @param {(method: string, path: string) => Promise<any>} args.get - api() bound to the repo.
 * @returns {Promise<{superseded: boolean, tip: string, reason: string}>}
 */
export async function checkSuperseded({ branch, baseSha, get }) {
	const ref = await get("GET", `/git/ref/heads/${branch}`);
	const tip = ref?.object?.sha || "";
	if (!tip) return { superseded: false, tip, reason: `could not read ${branch}'s tip` };
	if (tip === baseSha) return { superseded: false, tip, reason: `${branch} is still at ${baseSha.slice(0, 7)}` };
	const cmp = await get("GET", `/compare/${baseSha}...${tip}`);
	if (cmp?.status === "ahead") {
		return {
			superseded: true,
			tip,
			reason: `${branch} moved from ${baseSha.slice(0, 7)} to ${tip.slice(0, 7)} (${cmp.ahead_by} commit(s)) while this run was building; the newer run handles the release`
		};
	}
	return {
		superseded: false,
		tip,
		reason: `${branch} is at ${tip.slice(0, 7)}, which isn't ahead of ${baseSha.slice(0, 7)} (compare: ${cmp?.status || "unknown"})`
	};
}

const BIG_BUFFER = 1024 * 1024 * 256;

/** Run a git command and return trimmed stdout. */
const gitStr = (cmd) =>
	execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: BIG_BUFFER })
		.toString()
		.trim();

async function main() {
	const commitMessage = getInput("commit-message", { required: true });
	const token = getInput("github-token", { required: true });
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	// Stage everything; bail out cleanly if nothing changed.
	execSync("git add .", { stdio: "inherit" });
	let hasChanges = false;
	try {
		execSync("git diff --staged --quiet", { stdio: "ignore" });
	} catch {
		hasChanges = true;
	}
	if (!hasChanges) {
		console.log("No changes to commit");
		return;
	}

	const currentBranch = process.env.GITHUB_REF_NAME;
	const baseSha = gitStr("git rev-parse HEAD");

	try {
		execSync("git update-index --refresh", { stdio: "ignore" });
	} catch {
		// Refresh failures are non-fatal.
	}

	console.log("📦 Creating tree with version bump and build artifacts...");
	console.log("📄 Building API tree items from staged changes...");

	/**
	 * Create a blob from a staged path's content.
	 * @param {string} pathspec - Path whose staged (index) content to upload.
	 * @returns {Promise<string>} The created blob SHA.
	 */
	async function createBlob(pathspec) {
		const content = execSync(`git show ":${pathspec}"`, { maxBuffer: BIG_BUFFER }).toString("base64");
		const res = await api("POST", "/git/blobs", { content, encoding: "base64" }, { token, owner, repo });
		if (!res || !res.sha) throw new Error(`Failed creating blob for path: ${pathspec}`);
		return res.sha;
	}

	/** Resolve the git file mode for a staged path. */
	const modeOf = (pathspec) => gitStr(`git ls-files --stage -- "${pathspec}"`).split(/\s+/)[0] || "100644";

	// Build tree items from the staged name-status list.
	const treeItems = [];
	for (const line of gitStr("git diff --cached --name-status").split("\n")) {
		if (!line.trim()) continue;
		const [status, path, extra] = line.split("\t");
		if (!status) continue;

		if (status.startsWith("D")) {
			console.log(`Queue delete: ${path}`);
			treeItems.push({ path, mode: "100644", type: "blob", sha: null });
		} else if (status.startsWith("R")) {
			console.log(`Queue rename: ${path} -> ${extra}`);
			treeItems.push({ path, mode: "100644", type: "blob", sha: null });
			treeItems.push({ path: extra, mode: modeOf(extra), type: "blob", sha: await createBlob(extra) });
		} else {
			console.log(`Queue upsert: ${path}`);
			treeItems.push({ path, mode: modeOf(path), type: "blob", sha: await createBlob(path) });
		}
	}

	if (treeItems.length === 0) {
		throw new Error("No staged tree items were generated for API commit");
	}
	console.log(`✅ Prepared ${treeItems.length} tree items`);

	console.log("🌳 Creating tree via GitHub API...");
	const baseTree = gitStr("git rev-parse HEAD^{tree}");
	const treeRes = await api("POST", "/git/trees", { base_tree: baseTree, tree: treeItems }, { token, owner, repo });
	if (!treeRes || !treeRes.sha) {
		throw new Error("Failed to create tree via API");
	}
	console.log(`✅ Created tree via API: ${treeRes.sha}`);

	console.log("✍️ Creating signed commit via GitHub API...");
	const commitRes = await api(
		"POST",
		"/git/commits",
		{ message: commitMessage, tree: treeRes.sha, parents: [baseSha] },
		{ token, owner, repo }
	);
	if (!commitRes || !commitRes.sha) {
		throw new Error("Failed to create commit via API");
	}
	const newCommitSha = commitRes.sha;
	const verified = commitRes.verification?.verified;
	console.log(`✅ Created signed commit: ${newCommitSha}`);
	console.log(`🔐 Verified: ${verified} (reason: ${commitRes.verification?.reason})`);

	console.log("📌 Updating branch reference...");
	try {
		await api("PATCH", `/git/refs/heads/${currentBranch}`, { sha: newCommitSha }, { token, owner, repo });
	} catch (error) {
		if (!isNotFastForward(error)) throw error;
		const check = await checkSuperseded({
			branch: currentBranch,
			baseSha,
			get: (method, path) => api(method, path, null, { token, owner, repo })
		});
		if (!check.superseded) throw new Error(`${error.message} (${check.reason})`, { cause: error });
		console.log(`::notice title=Superseded run::${check.reason}`);
		setOutput("superseded", "true");
		return;
	}
	console.log(`✅ Updated branch ${currentBranch} to signed commit`);

	setOutput("commit-sha", newCommitSha);
	setOutput("verified", String(verified));
	setOutput("superseded", "false");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		await main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}
