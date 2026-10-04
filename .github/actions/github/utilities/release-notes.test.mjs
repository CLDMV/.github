#!/usr/bin/env node
// Ad-hoc checks for release-notes.mjs. Run: node .github/actions/github/utilities/release-notes.test.mjs
import assert from "node:assert/strict";
import { buildReleaseBody, neutralizeMentions, stripReleaseSubject, stripCommitTrailers, changelogCandidates, sameBody } from "./release-notes.mjs";

const contributors = "<details>\n<summary>👥 Contributors</summary>\n\n- @Shinrai\n\n</details>";
const coverage = "<!-- coverage-start -->\ncov\n<!-- coverage-end -->";
const squash = `release: v1.2.2 - run the mirror job\n\n## 🚀 What's Changed\n- thing\n\n${coverage}\n\n<!-- co-authors -->\n\n${contributors}\n\n---------\n\nCo-authored-by: Shinrai <Shinrai@users.noreply.github.com>`;

// Subject line and trailers go; body content stays.
const fallback = buildReleaseBody({ baseBody: squash, name: "v1.2.2", version: "1.2.2" });
assert.ok(!fallback.startsWith("release:"), "subject stripped");
assert.ok(!/Co-authored-by/.test(fallback), "trailers stripped");
assert.ok(fallback.includes("## 🚀 What's Changed") && fallback.includes(contributors));

// Changelog wins; coverage + contributors carried over once.
const fromFile = buildReleaseBody({ changelog: "# v1.2.2 Changelog\n\nNotes.", baseBody: squash, name: "v1.2.2", version: "1.2.2" });
assert.ok(fromFile.startsWith("# v1.2.2 Changelog"));
assert.equal(fromFile.split("coverage-start").length, 2);
assert.equal(fromFile.split("👥 Contributors").length, 2);
assert.ok(!fromFile.includes("What's Changed"));
assert.ok(sameBody(fromFile, buildReleaseBody({ changelog: fromFile, baseBody: fromFile, name: "v1.2.2", version: "1.2.2" })), "idempotent");

// Mentions: prose wrapped, contributors / code / emails / URLs untouched.
const allowed = ["Shinrai"];
assert.equal(neutralizeMentions("keeps @Author and @Date", allowed), "keeps `@Author` and `@Date`");
assert.equal(neutralizeMentions("thanks @Shinrai", allowed), "thanks @Shinrai");
assert.equal(neutralizeMentions("bump @cldmv/fix-headers", allowed), "bump `@cldmv/fix-headers`");
assert.equal(neutralizeMentions("`@Author` x", allowed), "`@Author` x");
assert.equal(neutralizeMentions("mail a@b.com https://x.dev/@foo", allowed), "mail a@b.com https://x.dev/@foo");
assert.equal(neutralizeMentions("```\n@Author\n```", allowed), "```\n@Author\n```");
assert.equal(neutralizeMentions("x @​Author", allowed), "x `@Author`");
assert.equal(neutralizeMentions(neutralizeMentions("@Author", allowed), allowed), "`@Author`");

assert.equal(stripReleaseSubject("v1.0.0\n\nbody", { name: "v1.0.0" }), "body");
assert.equal(stripReleaseSubject("Intro\nrelease: v1.0.0", { version: "1.0.0" }), "Intro\nrelease: v1.0.0");
assert.equal(stripCommitTrailers("a\n\n---\n\nb\n\n---------\n\nCo-authored-by: x <y>"), "a\n\n---\n\nb");
assert.deepEqual(changelogCandidates("v4.30.6").slice(0, 2), ["docs/changelog/v4/v4.30.6.md", "docs/changelog/v4.30.6.md"]);
assert.deepEqual(changelogCandidates("../etc"), []);

console.log("release-notes: all checks passed");
