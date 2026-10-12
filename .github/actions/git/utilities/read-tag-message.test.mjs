#!/usr/bin/env node
// readTagMessage() reads one tag's message from the repository so the detailed-tags
// JSON passed between actions can stay small (changelog-sized messages on 100 tags
// overran the per-argument limit: "Argument list too long").
// Run: node .github/actions/git/utilities/read-tag-message.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { annotatedTagArgs, readTagMessage } from "./git-utils.mjs";

const repo = mkdtempSync(path.join(tmpdir(), "read-tag-message-"));
const git = (...args) =>
	execFileSync(
		"git",
		["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "tag.gpgsign=false", "-c", "commit.gpgsign=false", ...args],
		{ cwd: repo, encoding: "utf8" }
	);

try {
	git("init", "-q");
	git("commit", "-q", "--allow-empty", "-m", "init");

	const message = "# v1.2.4 — changelog\n\n## Fixed\n\n- a fix\n";
	const msgFile = path.join(repo, "msg.txt");
	writeFileSync(msgFile, message, "utf8");
	git(...annotatedTagArgs({ tagName: "v1.2.4", target: "HEAD", messageFile: msgFile }));
	assert.equal(readTagMessage("v1.2.4", repo), message.trim(), "annotated tag keeps headings and blank lines");

	git("tag", "v1.0.0");
	assert.equal(readTagMessage("v1.0.0", repo), "v1.0.0", "lightweight tag falls back to its name");
	assert.equal(readTagMessage("v9.9.9", repo), "v9.9.9", "missing tag falls back to its name");

	// A signature block must never leak into the message that gets re-signed.
	const signed = path.join(repo, "signed.txt");
	writeFileSync(signed, "body\n\n-----BEGIN PGP SIGNATURE-----\n\nabc\n-----END PGP SIGNATURE-----\n", "utf8");
	git(...annotatedTagArgs({ tagName: "v1.2.5", target: "HEAD", messageFile: signed }));
	assert.equal(readTagMessage("v1.2.5", repo), "body", "signature block excluded");

	console.log("read-tag-message: all assertions passed");
} finally {
	rmSync(repo, { recursive: true, force: true });
}
