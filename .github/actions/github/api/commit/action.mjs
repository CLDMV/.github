/**
 * @fileoverview Create a signed commit via the GitHub API: build blobs and a
 * tree from the staged changes, create the commit, and move the branch ref.
 * Node entrypoint for the github/api/commit action.
 * @module @cldmv/.github.github.api.commit
 */

import { execSync } from "node:child_process";
import { api, parseRepo } from "../_api/core.mjs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

const BIG_BUFFER = 1024 * 1024 * 256;

/** Run a git command and return trimmed stdout. */
const gitStr = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: BIG_BUFFER }).toString().trim();

try {
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
		process.exit(0);
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
		console.error("::error::No staged tree items were generated for API commit");
		process.exit(1);
	}
	console.log(`✅ Prepared ${treeItems.length} tree items`);

	console.log("🌳 Creating tree via GitHub API...");
	const baseTree = gitStr("git rev-parse HEAD^{tree}");
	const treeRes = await api("POST", "/git/trees", { base_tree: baseTree, tree: treeItems }, { token, owner, repo });
	if (!treeRes || !treeRes.sha) {
		console.error("::error::Failed to create tree via API");
		process.exit(1);
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
		console.error("::error::Failed to create commit via API");
		process.exit(1);
	}
	const newCommitSha = commitRes.sha;
	const verified = commitRes.verification?.verified;
	console.log(`✅ Created signed commit: ${newCommitSha}`);
	console.log(`🔐 Verified: ${verified} (reason: ${commitRes.verification?.reason})`);

	console.log("📌 Updating branch reference...");
	await api("PATCH", `/git/refs/heads/${currentBranch}`, { sha: newCommitSha }, { token, owner, repo });
	console.log(`✅ Updated branch ${currentBranch} to signed commit`);

	setOutput("commit-sha", newCommitSha);
	setOutput("verified", String(verified));
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
