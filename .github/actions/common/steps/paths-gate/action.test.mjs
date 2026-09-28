#!/usr/bin/env node
/**
 * @fileoverview Tests for the paths-gate action: the docs_only decision on a
 * normal diff, and the fall-back-to-full-CI paths when the diff can't be
 * trusted (zero/missing `before`, `404 No common ancestor`, a `before` removed
 * by a force-push, a non-ancestor `before`). Each case runs action.mjs as a
 * subprocess, exactly as the Actions runner invokes it, with `fetch` replaced
 * by a preloaded mock that answers from a canned route table.
 * Run via `npm test` from the repo root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const actionPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "action.mjs");

let failures = 0;
function eq(actual, expected, label) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		console.error(`     expected: ${JSON.stringify(expected)}`);
		console.error(`     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

const BEFORE = "fd7d98bc6e3c42151ff6e04381a3bfaf7b9974a4";
const AFTER = "392bff48aeddaa490034c8fe40de7a41f6e6739a";
const ZERO = "0000000000000000000000000000000000000000";
const PATTERNS = "**.md\ndocs/**\nLICENSE";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "paths-gate-test-"));

// Preloaded into the action's process: replaces global fetch with a lookup in
// the MOCK_ROUTES table ({ "<url substring>": { status, body } }). Any request
// with no matching route is a test bug, so it answers 599.
const mockPath = path.join(scratch, "mock-fetch.mjs");
fs.writeFileSync(
	mockPath,
	`const routes = JSON.parse(process.env.MOCK_ROUTES || "{}");
globalThis.fetch = async (url) => {
	for (const [needle, { status, body }] of Object.entries(routes)) {
		if (String(url).includes(needle)) {
			return new Response(typeof body === "string" ? body : JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" }
			});
		}
	}
	return new Response("unmocked " + url, { status: 599 });
};
`
);

/**
 * Run the action against a synthetic event.
 * @param {object} opts
 * @param {string} opts.eventName - GITHUB_EVENT_NAME.
 * @param {object} opts.event - Event payload written to GITHUB_EVENT_PATH.
 * @param {object} [opts.routes] - Mock fetch route table.
 * @returns {{ status: number|null, stdout: string, stderr: string, docsOnly: string|undefined, notices: string[], errors: string[] }}
 */
function run({ eventName, event, routes = {} }) {
	const eventFile = path.join(scratch, "event.json");
	const outFile = path.join(scratch, "output.txt");
	fs.writeFileSync(eventFile, JSON.stringify(event));
	fs.rmSync(outFile, { force: true });
	const r = spawnSync(process.execPath, ["--import", pathToFileURL(mockPath).href, actionPath], {
		encoding: "utf8",
		env: {
			...process.env,
			INPUT_PATHS_IGNORE: PATTERNS,
			"INPUT_GITHUB-TOKEN": "test-token",
			GITHUB_REPOSITORY: "CLDMV/example",
			GITHUB_EVENT_NAME: eventName,
			GITHUB_EVENT_PATH: eventFile,
			GITHUB_OUTPUT: outFile,
			GITHUB_SHA: AFTER,
			MOCK_ROUTES: JSON.stringify(routes)
		}
	});
	const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
	const m = out.match(/^docs_only=(.*)$/m);
	const lines = `${r.stdout}\n${r.stderr}`.split("\n");
	return {
		status: r.status,
		stdout: r.stdout,
		stderr: r.stderr,
		docsOnly: m ? m[1] : undefined,
		notices: lines.filter((l) => l.startsWith("::notice")),
		errors: lines.filter((l) => l.startsWith("::error"))
	};
}

const compareRoute = `/compare/${BEFORE}...${AFTER}`;
const push = (before = BEFORE) => ({ before, after: AFTER });

try {
	console.log("push — normal diff (comparison works, behaviour unchanged):");
	let r = run({
		eventName: "push",
		event: push(),
		routes: { [compareRoute]: { status: 200, body: { status: "ahead", files: [{ filename: "README.md" }, { filename: "docs/a.md" }] } } }
	});
	eq(r.status, 0, "docs-only diff exits 0");
	eq(r.docsOnly, "true", "docs-only diff → docs_only=true");
	eq(r.notices, [], "no fallback notice");

	r = run({
		eventName: "push",
		event: push(),
		routes: {
			[compareRoute]: { status: 200, body: { status: "ahead", files: [{ filename: "README.md" }, { filename: "src/index.mjs" }] } }
		}
	});
	eq(r.status, 0, "mixed diff exits 0");
	eq(r.docsOnly, "false", "a tracked file → docs_only=false");
	eq(r.notices, [], "no fallback notice");

	r = run({
		eventName: "push",
		event: push(),
		routes: { [compareRoute]: { status: 200, body: { status: "identical", files: [] } } }
	});
	eq(r.docsOnly, "true", "identical compare (empty diff) → docs_only=true, as before");

	console.log("push — 404 No common ancestor (rewritten history):");
	r = run({
		eventName: "push",
		event: push(),
		routes: {
			[compareRoute]: {
				status: 404,
				body: {
					message: `No common ancestor between ${BEFORE} and ${AFTER}.`,
					documentation_url: "https://docs.github.com/rest/commits/commits#compare-two-commits",
					status: "404"
				}
			}
		}
	});
	eq(r.status, 0, "exits 0 (the gate does not fail the run)");
	eq(r.errors, [], "no ::error:: line");
	eq(r.docsOnly, "false", "falls back to docs_only=false (full CI)");
	eq(r.notices.length, 1, "emits one ::notice::");
	eq(/no common ancestor/.test(r.notices[0] || ""), true, "notice names the no-common-ancestor reason");

	console.log("push — zero `before` SHA (new branch / new ref):");
	r = run({ eventName: "push", event: push(ZERO) });
	eq(r.status, 0, "exits 0");
	eq(r.docsOnly, "false", "falls back to docs_only=false");
	eq(/zero SHA/.test(r.notices[0] || ""), true, "notice names the zero-SHA reason");

	console.log("push — missing `before`:");
	r = run({ eventName: "push", event: { after: AFTER } });
	eq(r.status, 0, "exits 0");
	eq(r.docsOnly, "false", "falls back to docs_only=false");
	eq(/missing/.test(r.notices[0] || ""), true, "notice names the missing-before reason");

	console.log("push — `before` removed by a force-push (404 Not Found):");
	r = run({
		eventName: "push",
		event: push(),
		routes: { [compareRoute]: { status: 404, body: { message: "Not Found", status: "404" } } }
	});
	eq(r.status, 0, "exits 0");
	eq(r.docsOnly, "false", "falls back to docs_only=false");
	eq(/not found/.test(r.notices[0] || ""), true, "notice names the unreachable-before reason");

	console.log("push — `before` not an ancestor (force-push, compare succeeds):");
	for (const status of ["diverged", "behind"]) {
		r = run({
			eventName: "push",
			event: push(),
			routes: { [compareRoute]: { status: 200, body: { status, files: [] } } }
		});
		eq(r.status, 0, `status=${status} exits 0`);
		eq(r.docsOnly, "false", `status=${status} → docs_only=false (an empty three-dot diff is not trusted)`);
		eq(new RegExp(`status=${status}`).test(r.notices[0] || ""), true, `notice names status=${status}`);
	}

	console.log("push — any other compare error:");
	r = run({
		eventName: "push",
		event: push(),
		routes: { [compareRoute]: { status: 500, body: { message: "Server Error" } } }
	});
	eq(r.status, 0, "500 exits 0");
	eq(r.docsOnly, "false", "500 → docs_only=false");
	eq(r.notices.length, 1, "500 emits a ::notice::");

	console.log("pull_request:");
	r = run({
		eventName: "pull_request",
		event: { number: 7, pull_request: { number: 7 } },
		routes: { "/pulls/7/files": { status: 200, body: [{ filename: "docs/guide.md" }] } }
	});
	eq(r.docsOnly, "true", "docs-only PR → docs_only=true");
	eq(r.notices, [], "no fallback notice");

	r = run({
		eventName: "pull_request",
		event: { number: 7, pull_request: { number: 7 } },
		routes: { "/pulls/7/files": { status: 404, body: { message: "Not Found" } } }
	});
	eq(r.status, 0, "PR files failure exits 0");
	eq(r.docsOnly, "false", "PR files failure → docs_only=false");
	eq(r.notices.length, 1, "PR files failure emits a ::notice::");

	console.log("no diff context (unchanged):");
	r = run({ eventName: "workflow_dispatch", event: {} });
	eq(r.status, 0, "workflow_dispatch exits 0");
	eq(r.docsOnly, "", "workflow_dispatch → empty docs_only");
	eq(r.notices, [], "no notice");
} finally {
	fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
