import assert from "node:assert/strict";
import { createOrphanBadgesBranch, BADGES_README } from "./badges-branch.mjs";

const calls = [];
const fake = async (method, path, body) => {
	calls.push({ method, path, body });
	if (path === "/git/trees") return { sha: "tree1" };
	if (path === "/git/commits") return { sha: "commit1" };
	return {};
};

const sha = await createOrphanBadgesBranch(fake, "badges");
assert.equal(sha, "commit1");
assert.equal(calls.length, 3);
assert.equal(calls[0].body.tree[0].path, "README.md");
assert.equal(calls[0].body.tree[0].content, BADGES_README);
assert.deepEqual(calls[1].body.parents, []);
assert.equal(calls[1].body.tree, "tree1");
assert.deepEqual(calls[2], { method: "POST", path: "/git/refs", body: { ref: "refs/heads/badges", sha: "commit1" } });
console.log("badges-branch tests passed");
