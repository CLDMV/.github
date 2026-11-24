#!/usr/bin/env node
/**
 * @fileoverview Tests for the commit-subjects action: the subject check itself,
 * branch routing, and the action run end to end as a subprocess (as the
 * Actions runner invokes it) with `fetch` replaced by a preloaded mock.
 * Run via `npm test` from the repo root.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isConventionalSubject, resolvePrBase, findBadSubjects, tableCell } from "./action.mjs";

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

console.log("isConventionalSubject — accepted:");
for (const s of [
	"feat: add x",
	"fix(release-pr): keep hand-edited titles",
	"feat!: drop node 20",
	"refactor(core)!: rename option",
	"chore: bump version to 1.2.3",
	"chore(deps): bump vitest from 4 to 5",
	"build(deps-dev): bump eslint",
	"deps: update fix-headers",
	"release: v4.41.1 - keep hand-edited release titles",
	"revert: feat: add x",
	"docs: v4.41.1 changelog",
	"feature: legacy alias",
	"perf: cache the lookup",
	"test: cover the 404 path",
	"ci: pin node",
	"style: format"
]) {
	eq(isConventionalSubject(s), true, s);
}

console.log("isConventionalSubject — rejected:");
for (const s of [
	"agent add: register the bridge",
	"connect test: retry",
	"smoke: run it",
	"bridge: wire the socket",
	"Feat: capitalised type",
	"feat:no space",
	"feat: ",
	"feat(): empty scope",
	"feat (core): space before scope",
	'Revert "feat: add x"',
	"fixup! feat: add x",
	"Initial plan",
	"wip",
	""
]) {
	eq(isConventionalSubject(s), false, JSON.stringify(s));
}

console.log("resolvePrBase:");
eq(resolvePrBase("feat/x"), "next", "feat/* → next");
eq(resolvePrBase("docs/v1-notes"), "next", "docs/* → next");
eq(resolvePrBase("hotfix/1.2.3"), "hotfixes", "hotfix/* → hotfixes");
eq(resolvePrBase("next"), null, "next itself → not checked");
eq(resolvePrBase("master"), null, "master → not checked");
eq(resolvePrBase("dependabot/npm_and_yarn/x"), null, "dependabot/* → not checked");
eq(resolvePrBase("copilot/fix-1"), null, "copilot/* → not checked");
eq(resolvePrBase("dev"), null, "dev → not checked");

console.log("findBadSubjects:");
const commit = (sha, message, parents = 1) => ({ sha, commit: { message }, parents: Array.from({ length: parents }, () => ({})) });
let res = findBadSubjects([
	commit("a".repeat(40), "feat: good\n\nbody"),
	commit("b".repeat(40), "agent add: bad"),
	commit("c".repeat(40), "Merge branch 'next' into feat/x", 2),
	commit("d".repeat(40), "smoke: bad too\n\nfeat: in the body doesn't count")
]);
eq(
	res.bad.map((b) => b.subject),
	["agent add: bad", "smoke: bad too"],
	"bad subjects listed, body lines ignored"
);
eq(res.checked, 3, "merge commit not counted as checked");
eq(res.merges, 1, "merge commit exempt");

console.log("tableCell:");
eq(tableCell("a | b"), "a \\| b", "pipe escaped");
eq(tableCell("a\\|b"), "a\\\\\\|b", "backslash escaped before the pipe");
eq(tableCell("`x` *y* _z_ <b> [l]"), "\\`x\\` \\*y\\* \\_z\\_ \\<b\\> \\[l\\]", "markdown punctuation escaped");

// ---- subprocess runs -------------------------------------------------------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "commit-subjects-test-"));
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

const AFTER = "392bff48aeddaa490034c8fe40de7a41f6e6739a";

function run({ eventName, event, routes = {} }) {
	const eventFile = path.join(scratch, "event.json");
	const outFile = path.join(scratch, "output.txt");
	const summaryFile = path.join(scratch, "summary.md");
	fs.writeFileSync(eventFile, JSON.stringify(event));
	fs.rmSync(outFile, { force: true });
	fs.rmSync(summaryFile, { force: true });
	const r = spawnSync(process.execPath, ["--import", pathToFileURL(mockPath).href, actionPath], {
		encoding: "utf8",
		env: {
			...process.env,
			"INPUT_GITHUB-TOKEN": "test-token",
			GITHUB_REPOSITORY: "CLDMV/example",
			GITHUB_EVENT_NAME: eventName,
			GITHUB_EVENT_PATH: eventFile,
			GITHUB_OUTPUT: outFile,
			GITHUB_STEP_SUMMARY: summaryFile,
			GITHUB_SHA: AFTER,
			GITHUB_REF: "",
			MOCK_ROUTES: JSON.stringify(routes)
		}
	});
	const out = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
	const m = out.match(/^ok=(.*)$/m);
	const lines = `${r.stdout}\n${r.stderr}`.split("\n");
	return {
		status: r.status,
		ok: m ? m[1] : undefined,
		errors: lines.filter((l) => l.startsWith("::error")),
		warnings: lines.filter((l) => l.startsWith("::warning")),
		summary: fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, "utf8") : ""
	};
}

const pushTo = (branch) => ({ ref: `refs/heads/${branch}`, after: AFTER });
const compareRoute = `/compare/next...${AFTER}`;

try {
	console.log("push to a feature branch:");
	let r = run({
		eventName: "push",
		event: pushTo("feat/x"),
		routes: {
			[compareRoute]: {
				status: 200,
				body: { total_commits: 2, commits: [commit("a".repeat(40), "feat: x"), commit("c".repeat(40), "Merge next", 2)] }
			}
		}
	});
	eq(r.status, 0, "clean range exits 0");
	eq(r.ok, "true", "ok=true");

	r = run({
		eventName: "push",
		event: pushTo("fix/y"),
		routes: {
			[compareRoute]: {
				status: 200,
				body: { total_commits: 2, commits: [commit("a".repeat(40), "fix: y"), commit("b".repeat(40), "agent add: z")] }
			}
		}
	});
	eq(r.status, 1, "bad subject exits 1");
	eq(r.ok, "false", "ok=false");
	eq(r.errors, ["::error title=Non-conventional commit subject::bbbbbbb agent add: z"], "error names the SHA and subject");
	eq(r.summary.includes("| `bbbbbbb` | agent add: z |"), true, "step summary lists it");

	r = run({
		eventName: "push",
		event: pushTo("hotfix/1.2.3"),
		routes: { [`/compare/hotfixes...${AFTER}`]: { status: 200, body: { total_commits: 1, commits: [commit("a".repeat(40), "smoke: z")] } } }
	});
	eq(r.ok, "false", "hotfix/* is checked against hotfixes");

	r = run({ eventName: "push", event: pushTo("next") });
	eq([r.status, r.ok], [0, ""], "push to next → not checked");

	r = run({ eventName: "push", event: pushTo("dependabot/npm_and_yarn/x") });
	eq([r.status, r.ok], [0, ""], "dependabot branch → not checked");

	r = run({
		eventName: "push",
		event: pushTo("feat/x"),
		routes: { [compareRoute]: { status: 404, body: { message: "No common ancestor" } } }
	});
	eq([r.status, r.ok], [0, ""], "compare failure → not checked, exit 0");
	eq(r.warnings.length, 1, "compare failure → warning");

	r = run({
		eventName: "push",
		event: pushTo("feat/x"),
		routes: { [compareRoute]: { status: 200, body: { total_commits: 300, commits: [commit("a".repeat(40), "feat: x")] } } }
	});
	eq([r.status, r.ok, r.warnings.length], [0, "true", 1], "capped compare → checks what it got, with a warning");

	console.log("pull_request:");
	r = run({
		eventName: "pull_request",
		event: { number: 7, pull_request: { number: 7, head: { ref: "feat/x" } } },
		routes: { "/pulls/7/commits": { status: 200, body: [commit("a".repeat(40), "Initial plan")] } }
	});
	eq([r.status, r.ok], [1, "false"], "fork PR with a bad subject fails");

	r = run({ eventName: "pull_request", event: { number: 8, pull_request: { number: 8, head: { ref: "next" } } } });
	eq([r.status, r.ok], [0, ""], "release PR → not checked");

	r = run({ eventName: "workflow_dispatch", event: {} });
	eq([r.status, r.ok], [0, ""], "workflow_dispatch → not checked");
} finally {
	fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll commit-subjects tests passed.");
