#!/usr/bin/env node
/**
 * @fileoverview Unit tests for merge-master-into-branch pure logic.
 * Run: `node test.mjs`. No network — only exercises exported functions.
 */

import { buildMergePayload, interpretMergeResponse } from "./action.mjs";

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

console.log("buildMergePayload:");
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master" }),
	{ base: "next", head: "master", commit_message: "Merge master into next" },
	"default message uses source/target names"
);
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master", commitMessage: "" }),
	{ base: "next", head: "master", commit_message: "Merge master into next" },
	"empty message falls back to default"
);
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master", commitMessage: "  " }),
	{ base: "next", head: "master", commit_message: "Merge master into next" },
	"whitespace-only message falls back to default"
);
eq(
	buildMergePayload({ targetBranch: "next", sourceRef: "master", commitMessage: "Custom msg" }),
	{ base: "next", head: "master", commit_message: "Custom msg" },
	"custom message used"
);

console.log("\ninterpretMergeResponse:");
eq(
	interpretMergeResponse(201, { sha: "abc123" }),
	{ performed: true, sha: "abc123", conflict: false, error: "" },
	"201 with sha → performed=true"
);
eq(
	interpretMergeResponse(201, {}),
	{ performed: true, sha: "", conflict: false, error: "" },
	"201 without sha → still performed=true, empty sha"
);
eq(
	interpretMergeResponse(204, null),
	{ performed: false, sha: "", conflict: false, error: "" },
	"204 (no content) → already up-to-date"
);
eq(
	interpretMergeResponse(409, { message: "Merge conflict" }),
	{ performed: false, sha: "", conflict: true, error: "Merge conflict (409) — manual resolution required" },
	"409 → conflict=true, error set"
);
const r404 = interpretMergeResponse(404, { message: "Not Found" });
eq(r404.performed, false, "404 → not performed");
eq(r404.conflict, false, "404 → not a conflict");
eq(r404.error.includes("404"), true, "404 error mentions status");
const r422 = interpretMergeResponse(422, { message: "Validation failed" });
eq(r422.error.includes("422"), true, "422 error mentions status");
const r500 = interpretMergeResponse(500, { message: "boom" });
eq(r500.error.includes("500"), true, "500 error mentions status");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
