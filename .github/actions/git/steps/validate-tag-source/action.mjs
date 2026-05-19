/**
 * @fileoverview Validate that a pushed tag points at a commit reachable from
 * main or master, so tag-health operations only run on release-branch tags.
 * Node entrypoint for the validate-tag-source action.
 * @module @cldmv/.github.git.steps.validate-tag-source
 */

import { execSync } from "node:child_process";
import { setOutputs } from "../../../common/common/core.mjs";

/** Check whether a git ref exists. */
function refExists(ref) {
	try {
		execSync(`git show-ref --verify --quiet ${ref}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Check whether `commit` is an ancestor of (i.e. reachable from) `branch`. */
function reachableFrom(commit, branch) {
	try {
		execSync(`git merge-base --is-ancestor ${commit} ${branch}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

try {
	const ref = process.env.GITHUB_REF || "";

	// Non-tag pushes always proceed.
	if (!ref.startsWith("refs/tags/")) {
		setOutputs({ "should-proceed": "true", message: "Not a tag push, proceeding normally" });
		console.log("🟢 Not a tag push, proceeding with workflow");
		process.exit(0);
	}

	const tagName = ref.slice("refs/tags/".length);
	console.log(`🏷️ Validating tag: ${tagName}`);

	const tagCommit = execSync(`git rev-list -n 1 "${tagName}"`).toString().trim();
	console.log(`📍 Tag points to commit: ${tagCommit}`);

	try {
		execSync("git fetch origin", { stdio: "ignore" });
	} catch {
		// A failed fetch is non-fatal — fall back to local refs.
	}

	let reachable = false;
	if (refExists("refs/remotes/origin/main") && reachableFrom(tagCommit, "origin/main")) {
		reachable = true;
		console.log("✅ Tag commit is reachable from main branch");
	}
	if (refExists("refs/remotes/origin/master") && reachableFrom(tagCommit, "origin/master")) {
		reachable = true;
		console.log("✅ Tag commit is reachable from master branch");
	}

	if (reachable) {
		setOutputs({ "should-proceed": "true", message: `Tag ${tagName} is reachable from main/master branch` });
		console.log("🟢 Validation passed: Tag is from main/master branch");
	} else {
		setOutputs({ "should-proceed": "false", message: `Tag ${tagName} is not reachable from main/master branch` });
		console.log("🟡 Validation failed: Tag is not from main/master branch, skipping major version tag updates");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
