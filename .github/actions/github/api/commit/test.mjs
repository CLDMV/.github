#!/usr/bin/env node
/**
 * @fileoverview Tests for github/api/commit: recognising a non-fast-forward
 * ref refusal and deciding whether the run was superseded (#467).
 * Run via `npm test` from the repo root.
 */

import { isNotFastForward, checkSuperseded } from "./action.mjs";

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

const BASE = "a".repeat(40);
const TIP = "b".repeat(40);

console.log("isNotFastForward:");
eq(isNotFastForward(new Error('PATCH /git/refs/heads/next -> 422: {"message":"Update is not a fast forward"}')), true, "the #467 error");
eq(isNotFastForward(new Error('PATCH /git/refs/heads/next -> 422: {"message":"Reference does not exist"}')), false, "other 422");
eq(isNotFastForward(new Error("PATCH /git/refs/heads/next -> 500: not a fast forward")), false, "non-422");
eq(isNotFastForward(undefined), false, "no error");

/** Fake api(): routes keyed by path. */
const fake = (routes) => async (method, path) => {
	if (!(path in routes)) throw new Error(`unexpected ${method} ${path}`);
	const r = routes[path];
	if (r instanceof Error) throw r;
	return r;
};

console.log("checkSuperseded:");
let r = await checkSuperseded({
	branch: "next",
	baseSha: BASE,
	get: fake({ "/git/ref/heads/next": { object: { sha: TIP } }, [`/compare/${BASE}...${TIP}`]: { status: "ahead", ahead_by: 2 } })
});
eq(r.superseded, true, "branch moved ahead → superseded");
eq(r.reason.includes("aaaaaaa") && r.reason.includes("bbbbbbb"), true, "reason names both commits");

r = await checkSuperseded({
	branch: "next",
	baseSha: BASE,
	get: fake({
		"/git/ref/heads/next": { object: { sha: TIP } },
		[`/compare/${BASE}...${TIP}`]: { status: "diverged", ahead_by: 1, behind_by: 3 }
	})
});
eq(r.superseded, false, "branch rewritten (diverged) → not superseded, fail");

r = await checkSuperseded({ branch: "next", baseSha: BASE, get: fake({ "/git/ref/heads/next": { object: { sha: BASE } } }) });
eq(r.superseded, false, "tip unchanged → not superseded");

r = await checkSuperseded({ branch: "next", baseSha: BASE, get: fake({ "/git/ref/heads/next": {} }) });
eq(r.superseded, false, "unreadable tip → not superseded");

let threw = false;
try {
	await checkSuperseded({ branch: "next", baseSha: BASE, get: fake({ "/git/ref/heads/next": new Error("GET -> 500") }) });
} catch {
	threw = true;
}
eq(threw, true, "a failing read propagates (the run still fails)");

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll github/api/commit tests passed.");
