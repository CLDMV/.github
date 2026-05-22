#!/usr/bin/env node
/**
 * @fileoverview Unit tests for pending-release-reminder pure logic.
 * Run: `node test.mjs`. No network.
 */

import {
	ageInDays,
	isoWeek,
	bucketLabel,
	dedupKey,
	shouldRemind,
	buildIssueTitle,
	buildIssueBody
} from "./action.mjs";

let failures = 0;
function eq(actual, expected, label) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) console.log(`  ✅ ${label}`);
	else {
		console.error(`  ❌ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

console.log("ageInDays:");
eq(ageInDays("2026-05-01T00:00:00Z", "2026-05-15T00:00:00Z"), 14, "14 days");
eq(ageInDays("2026-05-15T00:00:00Z", "2026-05-15T12:00:00Z"), 0, "same day → 0");
eq(ageInDays("2026-05-20T00:00:00Z", "2026-05-15T00:00:00Z"), 0, "negative clamped to 0");
eq(ageInDays("not-a-date", "2026-05-15T00:00:00Z"), 0, "invalid → 0");

console.log("\nisoWeek:");
eq(isoWeek(new Date("2026-01-01T00:00:00Z")), { year: 2026, week: 1 }, "2026-01-01 → 2026-W01");
eq(isoWeek(new Date("2026-05-22T00:00:00Z")).week >= 20 && isoWeek(new Date("2026-05-22T00:00:00Z")).week <= 22, true, "late May → ~W21");

console.log("\nbucketLabel:");
const d = new Date("2026-05-22T00:00:00Z");
eq(bucketLabel(d, "day"), "2026-05-22", "day bucket");
eq(bucketLabel(d, "month"), "2026-05", "month bucket");
eq(/^2026-W\d{2}$/.test(bucketLabel(d, "week")), true, "week bucket format YYYY-Www");
eq(bucketLabel(d, "weird"), bucketLabel(d, "week"), "unknown window defaults to week");

console.log("\ndedupKey:");
eq(dedupKey("next", d, "day"), "release-reminder-next-2026-05-22", "next/day key");
eq(/^release-reminder-hotfixes-2026-W\d{2}$/.test(dedupKey("hotfixes", d, "week")), true, "hotfixes/week key");

console.log("\nshouldRemind:");
eq(shouldRemind(15, 14), true, "15 > 14");
eq(shouldRemind(14, 14), false, "14 not > 14");
eq(shouldRemind(3, 3), false, "3 not > 3");
eq(shouldRemind(4, 3), true, "4 > 3");

console.log("\nbuildIssueTitle / buildIssueBody:");
const key = dedupKey("next", d, "week");
eq(buildIssueTitle("next", key).includes(key), true, "title carries dedup key");
const body = buildIssueBody({ branch: "next", prNumber: 42, ageDays: 15, thresholdDays: 14, key });
eq(body.includes("#42"), true, "body references PR number");
eq(body.includes("15 day"), true, "body references age");
eq(body.includes(key), true, "body carries dedup key");

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
