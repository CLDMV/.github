#!/usr/bin/env node
// tag/update: a tag that already points at the target commit is left alone, so the
// push trigger of update-major-version-tags cannot re-fire itself in a loop.
// Run: node .github/actions/github/api/tag/update/test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { run, tagPointsAt } from "./_impl.mjs";

const repo = mkdtempSync(path.join(tmpdir(), "tag-update-test-"));
const git = (...args) =>
	execFileSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "tag.gpgsign=false", "-c", "commit.gpgsign=false", ...args],
		{ cwd: repo, encoding: "utf8" }
	).trim();

const cwd = process.cwd();
try {
	git("init", "-q");
	git("commit", "-q", "--allow-empty", "-m", "one");
	const first = git("rev-parse", "HEAD");
	git("commit", "-q", "--allow-empty", "-m", "two");
	const second = git("rev-parse", "HEAD");

	git("tag", "-a", "-m", "v4", "v4", first);
	assert.equal(tagPointsAt("v4", first, repo), true, "annotated tag resolves to its commit");
	assert.equal(tagPointsAt("v4", second, repo), false, "tag at another commit needs an update");
	assert.equal(tagPointsAt("v9", first, repo), false, "missing tag needs an update");

	// run() returns before touching the tag, the remote or any credential.
	const before = git("rev-parse", "refs/tags/v4");
	process.chdir(repo);
	const out = await run({ token: "unused", repo: "o/r", tag: "v4", sha: first, message: "m" });
	assert.equal(out.ref_sha, first);
	assert.equal(git("rev-parse", "refs/tags/v4"), before, "tag object unchanged, so no new push event");

	console.log("tag/update: all assertions passed");
} finally {
	process.chdir(cwd);
	rmSync(repo, { recursive: true, force: true });
}
