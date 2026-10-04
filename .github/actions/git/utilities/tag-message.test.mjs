#!/usr/bin/env node
// Tag messages built from changelog files must keep their Markdown headings.
// git's default cleanup drops every line starting with `#` as a comment, which
// stripped `# … Changelog` / `## Overview` from release tag messages.
// Run: node .github/actions/git/utilities/tag-message.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { annotatedTagArgs } from "./git-utils.mjs";

const repo = mkdtempSync(path.join(tmpdir(), "tag-message-"));
const git = (...args) =>
	execFileSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "tag.gpgsign=false", "-c", "commit.gpgsign=false", ...args],
		{
			cwd: repo,
			encoding: "utf8"
		}
	);

try {
	git("init", "-q");
	git("commit", "-q", "--allow-empty", "-m", "init");
	const message = "# @cldmv/x v1.2.4 Changelog\n\n## Overview\n\nText.\n\n## 🐛 Bug Fixes\n\n- fix\n";
	const msgFile = path.join(repo, "msg.txt");
	writeFileSync(msgFile, message, "utf8");

	git(...annotatedTagArgs({ tagName: "v1.2.4", target: "HEAD", messageFile: msgFile }));
	const body = git("tag", "-l", "--format=%(contents)", "v1.2.4");
	assert.ok(body.includes("# @cldmv/x v1.2.4 Changelog"), "H1 heading kept");
	assert.ok(body.includes("## Overview"), "## heading kept");
	assert.ok(body.includes("## 🐛 Bug Fixes"), "emoji heading kept");

	// Replacing the tag (-f, the tag-health re-sign path) keeps them too.
	git(...annotatedTagArgs({ tagName: "v1.2.4", target: "HEAD", messageFile: msgFile }));
	assert.ok(git("tag", "-l", "--format=%(contents)", "v1.2.4").includes("## Overview"), "## heading kept on replace");

	// Control: without --cleanup=verbatim git drops the heading lines.
	git("tag", "-a", "-F", msgFile, "v0.0.1", "HEAD");
	assert.ok(!git("tag", "-l", "--format=%(contents)", "v0.0.1").includes("## Overview"), "default cleanup strips headings (control)");

	// Shell-string call sites keep the flag too.
	const here = path.dirname(fileURLToPath(import.meta.url));
	for (const rel of [
		"../../github/api/tag/create/_impl.mjs",
		"../../github/api/tag/update/_impl.mjs",
		"../../github/steps/fix-orphaned-releases/action.mjs"
	]) {
		const src = readFileSync(path.join(here, rel), "utf8");
		for (const line of src.split("\n").filter((l) => /\b(sh|gitCommand)\(`git tag -[as] /.test(l) && l.includes("-F"))) {
			assert.ok(line.includes("--cleanup=verbatim"), `${rel}: ${line.trim()}`);
		}
	}
	console.log("tag-message: all checks passed");
} finally {
	rmSync(repo, { recursive: true, force: true });
}
