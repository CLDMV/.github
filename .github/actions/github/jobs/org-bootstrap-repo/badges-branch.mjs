/**
 * @fileoverview Orphan `badges` branch creation for the org-bootstrap-repo
 * `branches` step. Kept separate from action.mjs (which runs main() on import)
 * so it can be unit-tested with a fake `api` function.
 *
 * @module @cldmv/.github.github.jobs.org-bootstrap-repo.badges-branch
 */

export const BADGES_README = [
	"# badges",
	"",
	"This branch is bot-managed. The coverage badge job pushes generated badge files here.",
	"Do not commit to it by hand; its history is the badge history."
].join("\n");

/**
 * Create the orphan badges branch: a one-file tree (README.md), a parentless
 * commit, then the ref. The caller has already established the branch does not
 * exist. The Git Data API signs the commit for the calling App.
 *
 * @param {(method: string, path: string, body?: object) => Promise<any>} call - API caller bound to the target repo.
 * @param {string} branch - Branch name to create.
 * @returns {Promise<string>} The new commit SHA.
 */
export async function createOrphanBadgesBranch(call, branch) {
	const tree = await call("POST", "/git/trees", {
		tree: [{ path: "README.md", mode: "100644", type: "blob", content: BADGES_README }]
	});
	const commit = await call("POST", "/git/commits", {
		message: "chore: initialize badges branch",
		tree: tree.sha,
		parents: []
	});
	await call("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha });
	return commit.sha;
}
