#!/usr/bin/env node
/**
 * @fileoverview Unit tests for publish-package pure helpers.
 * Run directly: `node test.mjs` in this directory. Exits non-zero on failure.
 */

import { isVersionAlreadyPublishedError } from "./_impl.mjs";

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

console.log("isVersionAlreadyPublishedError:");
// The EXACT real npm error that broke satellite idempotency
// (slothlet-i18n / slothlet-types @3.12.2). The prior literal substring
// "Cannot publish over previously published version" did NOT match this.
eq(
	isVersionAlreadyPublishedError(
		"npm error code E403\n" +
			"npm error 403 Forbidden - PUT https://registry.npmjs.org/@cldmv%2fslothlet-i18n - You cannot publish over the previously published versions: 3.12.2.\n" +
			"npm error 403 In most cases, you or one of your dependencies are requesting"
	),
	true,
	"real npm 403 'You cannot publish over the previously published versions: X' → true"
);
eq(
	isVersionAlreadyPublishedError("You cannot publish over the previously published version"),
	true,
	"singular 'version' variant → true"
);
eq(
	isVersionAlreadyPublishedError("Cannot publish over previously published version"),
	true,
	"the OLD literal phrasing still matches (no regression) → true"
);
// Real failures must NOT be misread as already-published no-ops.
eq(
	isVersionAlreadyPublishedError("npm error 403 Forbidden - you do not have permission to publish"),
	false,
	"generic 403 auth error → false"
);
eq(isVersionAlreadyPublishedError("npm error network timeout ETIMEDOUT"), false, "network error → false");
eq(isVersionAlreadyPublishedError(""), false, "empty output → false");
eq(isVersionAlreadyPublishedError(undefined), false, "undefined → false (no throw)");

if (failures) {
	console.error(`\n${failures} test(s) failed.`);
	process.exit(1);
}
console.log("\nAll tests passed.");
