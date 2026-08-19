/**
 * @fileoverview Replace a gh-pages branch's contents with a built docs
 * directory. Creates the branch as an orphan if missing. Uses a temp
 * workspace clone so the consumer's working tree is untouched.
 * Batch 6.1.
 * @module @cldmv/.github.common.jobs.publish-gh-pages
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { getInput, appendSummary } from "../../../common/common/core.mjs";

// Redact the access token from the tokenized remote URL wherever it may appear:
// the echoed command, or an execFileSync Error whose .message/.stderr embeds the
// full argv on failure.
function redact(str) {
	return String(str).replace(/(x-access-token:)[^@]+@/g, "$1***@");
}

// Render an argv for logging: redact the token, then JSON-encode any arg that
// isn't a simple bare token so whitespace, embedded quotes, and control chars
// (e.g. a commit message like `docs: it's ready`) render unambiguously instead
// of producing broken shell-style quoting. Bare tokens (flags, refs, paths,
// the redacted URL) print as-is for readability.
function showArgs(args) {
	return args
		.map((a) => {
			const r = redact(a);
			return /^[\w@.:/=+*~-]+$/.test(r) ? r : JSON.stringify(r);
		})
		.join(" ");
}

// Run git with its argv as an array through execFileSync — NO shell — so values
// interpolated from inputs/env (target_branch, commit_message, the tokenized
// remote URL, bot identity) are always literal arguments and can never be
// interpreted as shell syntax (CWE-78/88 command injection).
function git(args) {
	console.log(`$ git ${showArgs(args)}`);
	try {
		return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] })
			.toString()
			.trim();
	} catch (err) {
		// execFileSync's Error embeds the full argv (including the tokenized
		// remote URL) in .message, and git's own failure output in .stderr/.stdout.
		// Scrub every field that can carry the token before the error propagates
		// to the top-level handler that logs error.message.
		if (err) {
			if (typeof err.message === "string") err.message = redact(err.message);
			for (const k of ["stderr", "stdout"]) {
				if (err[k] != null) err[k] = redact(err[k]);
			}
		}
		throw err;
	}
}

function gitIgnoreFail(args) {
	try {
		return git(args);
	} catch {
		return "";
	}
}

/** Copy directory contents (not the dir itself) recursively. */
function copyDirContents(src, dest) {
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const s = path.join(src, entry.name);
		const d = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(d, { recursive: true });
			copyDirContents(s, d);
		} else if (entry.isFile()) {
			fs.copyFileSync(s, d);
		}
	}
}

/** Remove everything in a directory except .git. */
function clearExceptGit(dir) {
	for (const entry of fs.readdirSync(dir)) {
		if (entry === ".git") continue;
		fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
	}
}

try {
	const outputDir = getInput("output_dir", { required: true });
	const targetBranch = getInput("target_branch") || "gh-pages";
	const cname = getInput("cname") || "";
	const includeNojekyll = (getInput("include_nojekyll") || "true").toLowerCase() === "true";
	const commitMessage = getInput("commit_message") || "docs: update docs site";
	const token = getInput("github_token", { required: true });

	const absOutput = path.resolve(outputDir);
	if (!fs.existsSync(absOutput) || !fs.statSync(absOutput).isDirectory()) {
		throw new Error(`output_dir "${outputDir}" does not exist or is not a directory`);
	}
	const outputFiles = fs.readdirSync(absOutput);
	if (outputFiles.length === 0) {
		throw new Error(`output_dir "${outputDir}" is empty — refusing to publish empty site`);
	}
	console.log(`📁 Publishing ${outputFiles.length} entries from ${outputDir}`);

	const repository = process.env.GITHUB_REPOSITORY || "";
	if (!repository.includes("/")) throw new Error(`Invalid GITHUB_REPOSITORY: "${repository}"`);

	// Configure bot identity for the commit
	const botName = process.env.TAGGER_NAME || "CLDMV Bot";
	const botEmail = process.env.TAGGER_EMAIL || "bot@cldmv.net";

	// Use a temp clone so we don't disturb the consumer's working tree
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-pages-"));
	console.log(`📂 Temp clone: ${tmpDir}`);
	const remoteUrl = `https://x-access-token:${token}@github.com/${repository}.git`;

	// Try to clone the existing target branch; if it doesn't exist, create orphan.
	try {
		git(["clone", "--depth=1", `--branch=${targetBranch}`, "--single-branch", remoteUrl, tmpDir]);
		console.log(`✅ Cloned existing ${targetBranch} branch`);
	} catch {
		console.log(`ℹ️ ${targetBranch} not found — creating orphan branch`);
		git(["clone", "--depth=1", remoteUrl, tmpDir]);
		git(["-C", tmpDir, "checkout", "--orphan", targetBranch]);
		git(["-C", tmpDir, "rm", "-rf", "."]);
	}

	// Configure git identity in the temp clone
	git(["-C", tmpDir, "config", "user.name", botName]);
	git(["-C", tmpDir, "config", "user.email", botEmail]);

	// Replace contents
	clearExceptGit(tmpDir);
	copyDirContents(absOutput, tmpDir);

	if (cname) {
		fs.writeFileSync(path.join(tmpDir, "CNAME"), cname + "\n");
		console.log(`🌐 CNAME written: ${cname}`);
	}
	if (includeNojekyll) {
		fs.writeFileSync(path.join(tmpDir, ".nojekyll"), "");
		console.log(`📄 .nojekyll written`);
	}

	// Stage + commit
	git(["-C", tmpDir, "add", "-A"]);
	const status = gitIgnoreFail(["-C", tmpDir, "status", "--porcelain"]);
	if (!status) {
		console.log(`ℹ️ No changes vs current ${targetBranch} — skipping publish.`);
		appendSummary(`ℹ️ Docs site unchanged; no commit made.`);
		fs.rmSync(tmpDir, { recursive: true, force: true });
		process.exit(0);
	}

	git(["-C", tmpDir, "commit", "-m", commitMessage]);
	git(["-C", tmpDir, "push", "origin", targetBranch]);
	console.log(`🚀 Pushed to ${targetBranch}`);
	appendSummary(`🚀 Published docs to \`${targetBranch}\` (${outputFiles.length} top-level entries)`);

	fs.rmSync(tmpDir, { recursive: true, force: true });
} catch (error) {
	console.error(`::error::${redact(error.message)}`);
	process.exit(1);
}
