#!/usr/bin/env node
/**
 * @fileoverview Unit tests for resolve-release-base pure logic (priority order).
 * Run: `node test.mjs`. No network — importing the module does not run main()
 * (the entry is gated to script entry).
 */

import { resolveBase } from "./action.mjs";

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

console.log("resolveBase priority order:");
eq(
	resolveBase({ override: "release-x", configured: "cfg", detected: "main", fallback: "master" }),
	{ base: "release-x", source: "override" },
	"override wins over everything"
);
eq(
	resolveBase({ override: "", configured: "cfg", detected: "main", fallback: "master" }),
	{ base: "cfg", source: "configured" },
	"configured wins when override empty"
);
eq(
	resolveBase({ override: "", configured: "", detected: "main", fallback: "master" }),
	{ base: "main", source: "detected" },
	"detected wins when override + configured empty"
);
eq(
	resolveBase({ override: "", configured: "", detected: "", fallback: "master" }),
	{ base: "master", source: "fallback" },
	"fallback (master) when nothing else set"
);

console.log("\nwhitespace trimming:");
eq(
	resolveBase({ override: "  ", configured: "  main  ", detected: "develop", fallback: "master" }),
	{ base: "main", source: "configured" },
	"blank override skipped; configured trimmed"
);
eq(
	resolveBase({ override: "\t\n", configured: "", detected: "  trunk\n", fallback: "master" }),
	{ base: "trunk", source: "detected" },
	"whitespace-only override + empty configured → trimmed detected"
);
eq(
	resolveBase({ override: "  main  ", configured: "cfg", detected: "x", fallback: "master" }),
	{ base: "main", source: "override" },
	"override trimmed and still wins"
);

console.log("\nall-empty / missing:");
eq(resolveBase({ override: "", configured: "", detected: "", fallback: "" }), { base: "", source: "none" }, "all empty → none");
eq(resolveBase({}), { base: "", source: "none" }, "no args → none");
eq(
	resolveBase({ override: null, configured: undefined, detected: 0, fallback: "master" }),
	{ base: "master", source: "fallback" },
	"non-string candidates ignored → fallback"
);

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
