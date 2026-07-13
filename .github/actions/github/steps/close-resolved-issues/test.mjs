#!/usr/bin/env node
/**
 * @fileoverview Unit tests for close-resolved-issues pure helpers — the PR-ref
 * extraction, the `gh-broker:resolves:` marker parser, and the native-style
 * closing-keyword parser. Run: `node test.mjs`.
 */

import { extractMergedPRRefs, extractTrailingPRRef, extractResolvesMarkers, extractCloseKeywords, sourcePRTexts } from "./action.mjs";

let failures = 0;
function eq(actual, expected, label) {
	const a = actual instanceof Set ? [...actual].sort((x, y) => x - y) : actual;
	const e = expected instanceof Set ? [...expected].sort((x, y) => x - y) : expected;
	if (JSON.stringify(a) === JSON.stringify(e)) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}`);
		console.error(`     expected: ${JSON.stringify(e)}`);
		console.error(`     actual:   ${JSON.stringify(a)}`);
		failures++;
	}
}

console.log("extractMergedPRRefs:");
eq(extractMergedPRRefs("feat: add widgets (#123)"), new Set([123]), "single trailing ref");
eq(extractMergedPRRefs("chore: sync (#12) more text (#34)"), new Set([12, 34]), "two refs");
eq(extractMergedPRRefs("chore: bump version to 4.16.0"), new Set(), "no ref");
eq(extractMergedPRRefs("touches issue #123 inline"), new Set(), "bare #N (no parens) is not counted");
eq(extractMergedPRRefs(""), new Set(), "empty string");
eq(extractMergedPRRefs(null), new Set(), "null input");

console.log("\nextractTrailingPRRef:");
eq(extractTrailingPRRef("release: v4.16.0 - let bot-merged PRs trigger the lane (#138)"), 138, "release commit trailing ref");
eq(extractTrailingPRRef("chore: sync (#12) more text (#34)"), 34, "last of multiple refs wins");
eq(extractTrailingPRRef("chore: bump version to 4.16.0"), null, "no ref -> null");
eq(extractTrailingPRRef(""), null, "empty -> null");

console.log("\nextractResolvesMarkers:");
eq(
	extractResolvesMarkers("Resolves #123, #456 — closed when this ships to the default branch.\n<!-- gh-broker:resolves:123,456 -->"),
	new Set([123, 456]),
	"comma-separated, hash-prefixed visible line + plain marker"
);
eq(extractResolvesMarkers("<!-- gh-broker:resolves:42 -->"), new Set([42]), "single issue");
eq(extractResolvesMarkers("<!-- gh-broker:resolves: 123, 456 -->"), new Set([123, 456]), "spaced list");
eq(extractResolvesMarkers("<!-- gh-broker:resolves:#123,#456 -->"), new Set([123, 456]), "hash-prefixed numbers inside marker");
eq(extractResolvesMarkers("just a normal comment, no marker here"), new Set(), "no marker");
eq(
	extractResolvesMarkers("<!-- gh-broker:resolves:1 -->\nsome text\n<!-- gh-broker:resolves:2,3 -->"),
	new Set([1, 2, 3]),
	"multiple markers in one blob union"
);
eq(extractResolvesMarkers("<!-- GH-BROKER:RESOLVES:7 -->"), new Set([7]), "case-insensitive marker");
eq(extractResolvesMarkers("<!-- gh-broker:resolves: -->"), new Set(), "empty marker body");
eq(extractResolvesMarkers(""), new Set(), "empty string");
eq(extractResolvesMarkers(null), new Set(), "null input");

console.log("\nextractCloseKeywords:");
eq(extractCloseKeywords("fix: null pointer\n\nFixes #123"), new Set([123]), "Fixes (capitalized)");
eq(extractCloseKeywords("closes #45"), new Set([45]), "closes (lowercase)");
eq(extractCloseKeywords("This Closed #9 for good."), new Set([9]), "Closed, mid-sentence");
eq(extractCloseKeywords("Resolves #1, fixes #2 and closes #3"), new Set([1, 2, 3]), "multiple keyword forms in one blob");
eq(extractCloseKeywords("resolve #7"), new Set([7]), "resolve (bare form)");
eq(extractCloseKeywords("fix #8"), new Set([8]), "fix (bare form)");
eq(extractCloseKeywords("close #9"), new Set([9]), "close (bare form)");
eq(extractCloseKeywords("prefixes #123 is not a keyword match"), new Set(), "word-boundary guards against 'prefixes'");
eq(extractCloseKeywords("closes issue #123"), new Set(), "extra word between keyword and # breaks the match");
eq(extractCloseKeywords("just a normal message, no keyword"), new Set(), "no keyword");
eq(extractCloseKeywords(""), new Set(), "empty string");
eq(extractCloseKeywords(null), new Set(), "null input");

console.log("\nsourcePRTexts:");
eq(
	sourcePRTexts({ body: "desc", comments: [{ body: "a comment" }], commits: [{ commit: { message: "fix: x\n\nFixes #5" } }] }),
	["desc", "a comment", "fix: x\n\nFixes #5"],
	"gathers description, comment bodies, and commit messages in order"
);
eq(
	sourcePRTexts({ body: null, comments: [], commits: [{ commit: { message: "feat: y\n\nCloses #9" } }] }),
	["", "feat: y\n\nCloses #9"],
	"commit message is included even when the PR body/comments carry no keyword (the v4 merge-flow case)"
);
eq(sourcePRTexts({ body: "b" }), ["b"], "missing comments/commits arrays are tolerated");
eq(sourcePRTexts({}), [""], "empty input -> single empty body");
eq(sourcePRTexts(), [""], "no argument -> single empty body");
eq(
	sourcePRTexts({ body: "b", comments: [{}, { body: null }], commits: [{}, { commit: {} }] }),
	["b", "", "", "", ""],
	"missing body/message fields coerce to empty strings"
);

if (failures > 0) {
	console.error(`\n❌ ${failures} test(s) failed`);
	process.exit(1);
}
console.log("\n✅ all tests passed");
