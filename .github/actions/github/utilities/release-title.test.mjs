#!/usr/bin/env node
// Checks for release-title.mjs (#523). Run: node .github/actions/github/utilities/release-title.test.mjs
import assert from "node:assert/strict";
import {
	RELEASE_TITLE_MAX,
	truncateTitle,
	splitReleaseTitle,
	buildReleaseTitle,
	isGeneratedSuffix,
	resolveReleaseTitle,
	parseCandidates
} from "./release-title.mjs";

const longFeat = "--stall stops a run with no output, --hold keeps the pod for --exec";

// truncateTitle: word boundary, trailing spaces trimmed, "…" added, within the cap.
assert.equal(truncateTitle("release: v1.0.0 - short"), "release: v1.0.0 - short");
const cut = truncateTitle(`release: v0.6.0 - ${longFeat} and a good deal more text`);
assert.ok(cut.length <= RELEASE_TITLE_MAX, `cut length ${cut.length}`);
assert.ok(cut.endsWith("…") && !/\s…$/.test(cut), "ends with … and no space before it");
assert.ok(`release: v0.6.0 - ${longFeat} and a good deal more text`.startsWith(cut.slice(0, -1)), "cut is a prefix");
assert.equal(truncateTitle("x".repeat(100)).length, RELEASE_TITLE_MAX, "hard cut when no space");
assert.equal(truncateTitle("a\nb"), "a b", "newlines collapsed");

// splitReleaseTitle
assert.deepEqual(splitReleaseTitle("release: v1.2.3 - do a thing"), { version: "1.2.3", suffix: "do a thing", hasPrefix: true });
assert.deepEqual(splitReleaseTitle("release: v1.2.3"), { version: "1.2.3", suffix: "", hasPrefix: true });
assert.deepEqual(splitReleaseTitle("release!: v2.0.0: big"), { version: "2.0.0", suffix: "big", hasPrefix: true });
assert.deepEqual(splitReleaseTitle("My own title"), { version: "", suffix: "My own title", hasPrefix: false });

// buildReleaseTitle
assert.equal(buildReleaseTitle("1.2.3", ""), "release: v1.2.3");
assert.equal(buildReleaseTitle("v1.2.3", "x"), "release: v1.2.3 - x");

// isGeneratedSuffix: full, truncated by the old 55-char rule, truncated by the new rule.
const candidates = [longFeat, "fix the other thing"];
assert.equal(isGeneratedSuffix(longFeat, candidates), true, "full match");
assert.equal(isGeneratedSuffix("--stall stops a run with no output, --hold keeps the…", candidates), true, "old 55-char truncation");
assert.equal(isGeneratedSuffix("--stall stops a run…", candidates), true, "any truncation");
assert.equal(isGeneratedSuffix("", candidates), true, "empty = plain generated form");
assert.equal(isGeneratedSuffix("k3s-test: --stall and --hold", candidates), false, "hand edit");
assert.equal(isGeneratedSuffix("something else…", candidates), false, "hand edit ending in …");

// resolveReleaseTitle — the github-platform#55 case: generated title regenerates.
let r = resolveReleaseTitle({
	currentTitle: "release: v0.6.0 - --stall stops a run with no output, --hold keeps the…",
	version: "0.6.0",
	generatedSuffix: longFeat,
	candidates
});
assert.equal(r.source, "generated");
assert.equal(r.title, truncateTitle(`release: v0.6.0 - ${longFeat}`));

// Hand edit survives a refresh; only the prefix is kept current.
r = resolveReleaseTitle({
	currentTitle: "release: v0.6.0 - k3s-test: --stall and --hold",
	version: "0.6.0",
	generatedSuffix: longFeat,
	candidates
});
assert.deepEqual(r, { title: "release: v0.6.0 - k3s-test: --stall and --hold", source: "manual" });

// Stale version replaced on a hand-edited title.
r = resolveReleaseTitle({
	currentTitle: "release: v0.6.0 - k3s-test: --stall and --hold",
	version: "0.7.0",
	generatedSuffix: longFeat,
	candidates
});
assert.equal(r.title, "release: v0.7.0 - k3s-test: --stall and --hold");

// Prefix removed by hand → put back.
r = resolveReleaseTitle({ currentTitle: "k3s-test: --stall and --hold", version: "0.6.0", generatedSuffix: longFeat, candidates });
assert.deepEqual(r, { title: "release: v0.6.0 - k3s-test: --stall and --hold", source: "manual" });

// A newer commit changes which commit drives the suffix: the old generated title still counts as generated.
r = resolveReleaseTitle({ currentTitle: "release: v0.6.0 - fix the other thing", version: "0.7.0", generatedSuffix: longFeat, candidates });
assert.equal(r.source, "generated");
assert.ok(r.title.startsWith("release: v0.7.0 - --stall"));

// Long hand edit is truncated last.
r = resolveReleaseTitle({
	currentTitle: `release: v1.0.0 - ${"word ".repeat(30)}`,
	version: "1.0.0",
	generatedSuffix: "x",
	candidates: ["x"]
});
assert.equal(r.source, "manual");
assert.ok(r.title.length <= RELEASE_TITLE_MAX && r.title.endsWith("…"));

// New PR (no current title).
assert.deepEqual(resolveReleaseTitle({ version: "1.0.0", generatedSuffix: "" }), { title: "release: v1.0.0", source: "generated" });

// parseCandidates
assert.deepEqual(parseCandidates('["a","b",3]'), ["a", "b"]);
assert.deepEqual(parseCandidates("not json"), []);
assert.deepEqual(parseCandidates(""), []);

console.log("release-title: all checks passed");
