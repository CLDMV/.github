#!/usr/bin/env node
/**
 * @fileoverview Unit tests for generate-matrix's buildMatrix/parseMajor — the
 * Node.js test-matrix builder, focused on the `lts/*` redundancy dedup: an
 * explicit major already in the matrix (e.g. max-node-major, or an even major
 * from the lts-only sweep) must not also be tested a second time under the
 * "lts/*" label once that major IS the resolved current LTS. Run: `node test.mjs`.
 */

import { buildMatrix, parseMajor } from "./action.mjs";

let failures = 0;
function eq(actual, expected, label) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		console.error(`     expected: ${JSON.stringify(expected)}`);
		console.error(`     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

console.log("parseMajor:");
eq(parseMajor("24.9.0"), 24, "bare major.minor.patch");
eq(parseMajor("v24.9.0"), 24, "leading v stripped");
eq(parseMajor("26"), 26, "bare major");
eq(parseMajor(""), null, "empty string → null");
eq(parseMajor(undefined), null, "undefined → null");
eq(parseMajor("lts/*"), null, "unresolved alias (not an actual version) → null");

console.log("\nbuildMatrix — no min (single max + lts) shape:");
eq(
	buildMatrix({ min: "", maxInput: "", ltsOnly: false, currentLtsVersion: "24.9.0" }),
	["26", "lts/*"],
	"default max (26) + distinct current LTS (24) → both kept"
);
eq(
	buildMatrix({ min: "", maxInput: "26", ltsOnly: false, currentLtsVersion: "26.1.0" }),
	["26"],
	"max IS the resolved current LTS → lts/* dropped, no duplicate job"
);
eq(
	buildMatrix({ min: "", maxInput: "26", ltsOnly: false, currentLtsVersion: "" }),
	["26", "lts/*"],
	"unresolved currentLtsVersion → dedup disabled, lts/* always kept"
);

console.log("\nbuildMatrix — full sweep (min set):");
eq(
	buildMatrix({ min: "22.12.0", maxInput: "26", ltsOnly: false, currentLtsVersion: "24.9.0" }),
	["22.12", "23", "24", "25", "26"],
	"current LTS (24) already explicit mid-range → still a literal duplicate install, lts/* dropped"
);
eq(
	buildMatrix({ min: "22.12.0", maxInput: "26", ltsOnly: false, currentLtsVersion: "26.1.0" }),
	["22.12", "23", "24", "25", "26"],
	"current LTS === max and already explicit in the full sweep → lts/* dropped"
);
eq(
	buildMatrix({ min: "22.12.0", maxInput: "26", ltsOnly: true, currentLtsVersion: "24.9.0" }),
	["22.12", "24", "26"],
	"lts-only sweep already contains the current LTS (24, even) explicitly → lts/* dropped"
);
eq(
	buildMatrix({ min: "22.12.0", maxInput: "26", ltsOnly: true, currentLtsVersion: "" }),
	["22.12", "24", "26", "lts/*"],
	"lts-only sweep, unresolved currentLtsVersion → dedup disabled, lts/* kept"
);
eq(
	// min "22.12.0" consumes major 22 as the pinned "22.12" entry and advances past it, so with
	// max=22 the sweep loop never runs (nothing left ≤ max to add) — versions is just ["22.12"].
	buildMatrix({ min: "22.12.0", maxInput: "22", ltsOnly: false, currentLtsVersion: "26.1.0" }),
	["22.12", "lts/*"],
	"current LTS (26) is OUTSIDE the swept range (max=22) → not a duplicate, lts/* kept"
);
eq(
	buildMatrix({ min: "26.0.0", maxInput: "26", ltsOnly: false, currentLtsVersion: "26.1.0" }),
	["26.0", "lts/*"],
	"exact major.minor pin (26.0) is NOT the same install as lts/*'s latest patch → not deduped"
);

console.log("\nbuildMatrix — error handling:");
try {
	buildMatrix({ min: "not-a-number", maxInput: "", ltsOnly: false, currentLtsVersion: "" });
	console.error("  ❌ invalid min-node-version should throw");
	failures++;
} catch (err) {
	eq(/is not a valid major/.test(err.message), true, "invalid min-node-version throws a descriptive error");
}

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
