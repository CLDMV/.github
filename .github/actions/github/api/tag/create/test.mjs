#!/usr/bin/env node
// tag/create: signed tag creation pushes a signed, verbatim-message tag; a
// refused push throws (naming the tag) and never falls back to an unsigned tag.
// Run: node .github/actions/github/api/tag/create/test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAndPushTag, run } from "./_impl.mjs";

const root = mkdtempSync(path.join(tmpdir(), "tag-create-test-"));
const gnupg = path.join(root, "gnupg");
mkdirSync(gnupg, { mode: 0o700 });
const env = { ...process.env, GNUPGHOME: gnupg, GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
const sh = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const savedEnv = {
	GNUPGHOME: process.env.GNUPGHOME,
	GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
	GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
	RUNNER_TEMP: process.env.RUNNER_TEMP
};
Object.assign(process.env, { GNUPGHOME: gnupg, GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: "1", RUNNER_TEMP: root });

try {
	// Throwaway signing key, no passphrase.
	sh("gpg", [
		"--batch",
		"--pinentry-mode",
		"loopback",
		"--passphrase",
		"",
		"--quick-gen-key",
		"Test Bot <bot@example.com>",
		"ed25519",
		"sign",
		"1d"
	]);
	const keyid = sh("gpg", ["--list-secret-keys", "--with-colons"])
		.split("\n")
		.find((l) => l.startsWith("sec:"))
		.split(":")[4];

	// Work repo + bare remote.
	const remote = path.join(root, "remote.git");
	const work = path.join(root, "work");
	sh("git", ["init", "-q", "--bare", remote]);
	sh("git", ["init", "-q", work]);
	for (const [k, v] of [
		["user.name", "Test Bot"],
		["user.email", "bot@example.com"],
		["user.signingkey", keyid],
		["commit.gpgsign", "false"]
	])
		sh("git", ["config", k, v], work);
	sh("git", ["commit", "-q", "--allow-empty", "-m", "release: v1.2.3 - x"], work);
	const sha = sh("git", ["rev-parse", "HEAD"], work).trim();
	const message = "# pkg v1.2.3 Changelog\n\n## Overview\n\nNotes.\n";

	// 1. Signed path: the tag on the remote is signed and keeps the headings.
	createAndPushTag({ tag: "v1.2.3", sha, message, annotate: true, sign: true, remote, cwd: work });
	const obj = sh("git", ["cat-file", "-p", "refs/tags/v1.2.3"], remote);
	assert.match(obj, /-----BEGIN PGP SIGNATURE-----/, "remote tag is signed");
	assert.ok(obj.includes("## Overview") && obj.includes("# pkg v1.2.3 Changelog"), "headings kept verbatim");
	sh("git", ["tag", "-v", "v1.2.3"], work); // throws if the signature doesn't verify

	// 2. Refused push: throws naming the tag and git's reason; nothing on the remote.
	const hook = path.join(remote, "hooks", "pre-receive");
	writeFileSync(
		hook,
		"#!/bin/sh\necho 'refusing to allow a GitHub App to create or update workflow without workflows permission' >&2\nexit 1\n"
	);
	chmodSync(hook, 0o755);
	assert.throws(
		() => createAndPushTag({ tag: "v1.2.4", sha, message, annotate: true, sign: true, remote, cwd: work }),
		(e) => /v1\.2\.4/.test(e.message) && /refused/.test(e.message) && /workflows permission/.test(e.message),
		"refused push throws with tag name and git's error"
	);
	assert.equal(sh("git", ["tag", "-l", "v1.2.4"], remote).trim(), "", "no tag created on the remote");

	// 3. run(): same refusal propagates, and no REST call is attempted (no fallback).
	const realFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = async () => {
		fetchCalls++;
		throw new Error("unexpected REST call");
	};
	try {
		await assert.rejects(
			run({
				token: "x",
				repo: "o/r",
				tag: "v1.2.5",
				sha,
				message,
				gpg_enabled: true,
				skipPrecheck: true,
				configureRemote: false,
				remote,
				cwd: work
			}),
			/Push of tag v1\.2\.5 was refused/
		);
	} finally {
		globalThis.fetch = realFetch;
	}
	assert.equal(fetchCalls, 0, "no REST fallback");
	assert.equal(sh("git", ["tag", "-l", "v1.2.5"], remote).trim(), "", "no unsigned tag created");

	console.log("tag/create: all checks passed");
} finally {
	for (const [k, v] of Object.entries(savedEnv)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	try {
		execFileSync("gpgconf", ["--kill", "gpg-agent"], { env, stdio: "ignore" });
	} catch {
		// agent may not be running
	}
	rmSync(root, { recursive: true, force: true });
}
