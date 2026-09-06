/**
 * @fileoverview Commit and push badge.json to the badges branch, creating it
 * as an orphan branch on first run and skipping the commit when unchanged.
 * Node entrypoint for the push-badge action.
 * @module @cldmv/.github.coverage.steps.push-badge
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getInput } from "../../../common/common/core.mjs";

/**
 * Run a git command with its arguments passed as an array — never a shell
 * string. execFileSync spawns git directly (no `sh -c`), so caller-/env-derived
 * values (branch names, the badge filename, the auth'd remote URL) can never be
 * reinterpreted as shell syntax. This is the CodeQL-recommended remediation for
 * js/indirect-command-line-injection.
 * @param {string[]} args - git arguments.
 * @param {object} [opts] - execFileSync options (stdio, env, …).
 * @returns {Buffer|string} execFileSync result.
 */
const git = (args, opts = {}) => execFileSync("git", args, opts);

// The push token is read inside the try below (so a missing token surfaces as a
// clear, caught error instead of an `...:undefined@...` auth failure). It's
// declared here at module scope only so `redact` — used by the top-level catch
// handler — can scrub it from any log line: git errors can echo the
// token-bearing remote URL. App tokens are also GitHub-Actions-masked, so this
// is defense-in-depth.
let botToken;
const redact = (value) => (botToken ? String(value).split(botToken).join("***") : String(value));

try {
	botToken = process.env.BOT_TOKEN || getInput("bot-token");
	if (!botToken) {
		throw new Error("push-badge: a push token is required — set the BOT_TOKEN env var or the bot-token input.");
	}

	const badgesBranch = getInput("badges-branch", { default: "badges" });
	const badgeFile = getInput("badge-filename", { default: "coverage.json" });
	const botName = getInput("bot-name", { required: true });
	const botEmail = getInput("bot-email", { required: true });
	const repository = getInput("repository", { required: true });

	console.log("::notice::push coverage badge (Node)");

	git(["config", "user.name", botName]);
	git(["config", "user.email", botEmail]);

	// Stash the computed badge outside the work tree before switching branches.
	const stashedBadge = path.join(process.env.RUNNER_TEMP || ".", badgeFile);
	fs.copyFileSync("badge.json", stashedBadge);

	// The type-check / coverage runs leave the tree dirty; git won't switch
	// branches with a dirty tree, so stash everything first.
	console.log("Stashing working tree before branch switch…");
	try {
		git(["stash", "push", "--include-untracked", "--message", "badge-branch-switch"], { stdio: "inherit" });
	} catch {
		// Nothing to stash is fine.
	}

	let fetched = false;
	try {
		git(["fetch", "origin", badgesBranch], { stdio: "ignore" });
		fetched = true;
	} catch {
		fetched = false;
	}

	if (fetched) {
		git(["checkout", badgesBranch], { stdio: "inherit" });
	} else {
		// First run: create an orphan branch with no history.
		git(["checkout", "--orphan", badgesBranch], { stdio: "inherit" });
		try {
			git(["rm", "-rf", ".", "--quiet"], { stdio: "ignore" });
		} catch {
			// Empty tree is fine.
		}
	}

	// Commit + push with retry. The coverage-badge trigger fires on the
	// default branch, `next`, AND `hotfixes`, so several branch runs can
	// target the shared `badges` branch at once. Each writes a DISTINCT
	// filename (coverage.json / coverage-next.json / coverage-hotfixes.json),
	// so there is never a content conflict — but a concurrent job can still
	// advance the branch tip between our fetch and our push, rejecting ours
	// as non-fast-forward. On that rejection, re-sync onto the latest tip and
	// replay our badge on top so a concurrent loser never drops its badge.
	const remote = `https://x-access-token:${botToken}@github.com/${repository}.git`;
	const maxAttempts = 5;
	/** Synchronous, dependency-free sleep so retries don't collide in lockstep. */
	const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		fs.copyFileSync(stashedBadge, badgeFile);
		git(["add", badgeFile]);

		let unchanged = false;
		try {
			git(["diff", "--cached", "--quiet"], { stdio: "ignore" });
			unchanged = true;
		} catch {
			unchanged = false;
		}
		if (unchanged) {
			console.log("Badge unchanged — skipping commit.");
			process.exit(0);
		}

		git(["commit", "-S", "-m", "ci: update coverage badge"], { stdio: "inherit" });

		try {
			// Pipe stderr so a rejection can be classified below; git writes push
			// progress to stderr, so nothing actionable is lost on success.
			git(["push", remote, badgesBranch], { stdio: ["ignore", "inherit", "pipe"] });
			process.exit(0);
		} catch (pushError) {
			const stderr = pushError.stderr ? redact(pushError.stderr.toString()).trim() : "";
			// Only a non-fast-forward rejection (a concurrent badge job advanced
			// the shared `badges` tip) is retryable. Auth / permission / network
			// failures are surfaced immediately rather than retried behind a
			// misleading "rejected" warning.
			const nonFastForward = /\[rejected\]|fetch first|non-fast-forward|updates were rejected/i.test(stderr);
			if (!nonFastForward || attempt === maxAttempts) {
				throw new Error(stderr || redact(pushError.message), { cause: pushError });
			}
			console.log(
				`::warning::badge push rejected (non-fast-forward, attempt ${attempt}/${maxAttempts}) — re-syncing '${badgesBranch}' and retrying…`
			);
			// Move onto the tip the concurrent job advanced (dropping our
			// just-made commit) and let the loop replay our badge file on the new
			// base — distinct per-branch filenames guarantee a clean replay.
			sleepSync(200 + Math.floor(Math.random() * 400));
			git(["fetch", "origin", badgesBranch], { stdio: "ignore" });
			git(["reset", "--hard", "FETCH_HEAD"], { stdio: "inherit" });
		}
	}
} catch (error) {
	console.error(`::error::${redact(error.message)}`);
	process.exit(1);
}
