#!/usr/bin/env node
// Ad-hoc checks for release-notes.mjs. Run: node .github/actions/github/utilities/release-notes.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
	escapeTableCell,
	buildReleaseBody,
	neutralizeMentions,
	stripReleaseSubject,
	stripCommitTrailers,
	changelogCandidates,
	pinRelativeLinks,
	indexReleasePrs,
	releaseTitleVersion,
	repinBranchLinks,
	sameBody
} from "./release-notes.mjs";

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
assert.ok(
	sameBody(fromFile, buildReleaseBody({ changelog: fromFile, baseBody: fromFile, name: "v1.2.2", version: "1.2.2" })),
	"idempotent"
);

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

// Table cells: backslash escaped before the pipe, newlines collapsed.
assert.equal(escapeTableCell("a|b"), "a\\|b");
assert.equal(escapeTableCell("a\\|b"), "a\\\\\\|b");
assert.equal(escapeTableCell("C:\\path\\x"), "C:\\\\path\\\\x");
assert.equal(escapeTableCell("line1\r\nline2"), "line1 line2");
assert.equal(escapeTableCell(null), "");

// Relative links in a changelog are pinned to the release tag (CLDMV/.github#457).
const R = "https://github.com/CLDMV/x";
const pin = (md, ref = "v0.9.0") => pinRelativeLinks(md, { repo: "CLDMV/x", filePath: "docs/changelog/v0/v0.9.0.md", ref });
assert.equal(pin("[d](../../drivers.md)"), `[d](${R}/blob/v0.9.0/docs/drivers.md)`);
assert.equal(pin("[s](./v0.9.0.md)"), `[s](${R}/blob/v0.9.0/docs/changelog/v0/v0.9.0.md)`);
assert.equal(pin("[p](../v0/v0.8.0.md#fixes)"), `[p](${R}/blob/v0.9.0/docs/changelog/v0/v0.8.0.md#fixes)`);
assert.equal(pin("[l](/LICENSE)"), `[l](${R}/blob/v0.9.0/LICENSE)`);
assert.equal(pin('![i](../../img/a.png "Title")'), `![i](${R}/raw/v0.9.0/docs/img/a.png "Title")`);
assert.equal(
	pin('<img src="./a.png"> <a href="../x.md">x</a>'),
	`<img src="${R}/raw/v0.9.0/docs/changelog/v0/a.png"> <a href="${R}/blob/v0.9.0/docs/changelog/x.md">x</a>`
);
assert.equal(pin('[r]: ../../docs.md "T"'), `[r]: ${R}/blob/v0.9.0/docs/docs.md "T"`);
assert.equal(pin("[sp](<../my file.md>)"), `[sp](${R}/blob/v0.9.0/docs/changelog/my%20file.md)`);
for (const keep of [
	"[a](https://e.com/x.md)",
	"[a](//e.com/x)",
	"[a](#top)",
	"[a](mailto:a@b.c)",
	"`[a](./x.md)`",
	"[a](../../../../outside.md)",
	"```md\n[a](./x.md)\n```",
	"~~~\n![a](./x.png)\n~~~"
]) {
	assert.equal(pin(keep), keep, `unchanged: ${keep}`);
}
assert.equal(pin(pin("[d](../../drivers.md)")), pin("[d](../../drivers.md)"), "idempotent");
assert.equal(
	pin("[d](./a.md)", (p) => (p.endsWith("a.md") ? "master" : "v0.9.0")),
	`[d](${R}/blob/master/docs/changelog/v0/a.md)`,
	"per-path ref"
);
assert.equal(pinRelativeLinks("[d](./a.md)", { filePath: "docs/x.md", ref: "v1" }), "[d](./a.md)", "no repo → unchanged");
// buildReleaseBody pins the file's links, the generated fallback is untouched.
assert.ok(
	buildReleaseBody({
		changelog: "[d](./a.md)",
		name: "v1.0.0",
		version: "1.0.0",
		repo: "CLDMV/x",
		changelogPath: "docs/changelog/v1/v1.0.0.md"
	}).includes(`${R}/blob/v1.0.0/docs/changelog/v1/a.md`)
);
assert.ok(buildReleaseBody({ baseBody: "[d](./a.md)", name: "v1.0.0", version: "1.0.0", repo: "CLDMV/x" }).includes("[d](./a.md)"));

// Open release PR → head-branch links; release-merge / sync → tag links.
const onNext = pin("[d](../../drivers.md) ![i](./a.png)", "next");
assert.equal(onNext, `[d](${R}/blob/next/docs/drivers.md) ![i](${R}/raw/next/docs/changelog/v0/a.png)`);
const onTag = repinBranchLinks(onNext, { repo: "CLDMV/x", from: "next", to: "v0.9.0" });
assert.equal(onTag, pin("[d](../../drivers.md) ![i](./a.png)"), "next links become the same tag links");
assert.equal(repinBranchLinks(onTag, { repo: "CLDMV/x", from: "next", to: "v0.9.0" }), onTag, "idempotent");
assert.equal(repinBranchLinks(`${R}/tree/next/docs`, { repo: "CLDMV/x", from: "next", to: "v1.0.0" }), `${R}/tree/v1.0.0/docs`);
for (const keep of ["https://github.com/CLDMV/other/blob/next/a.md", `${R}/blob/nextgen/a.md`, `${R}/blob/master/a.md`, `${R}/pull/12`]) {
	assert.equal(repinBranchLinks(keep, { repo: "CLDMV/x", from: "next", to: "v1.0.0" }), keep, `unchanged: ${keep}`);
}
assert.equal(repinBranchLinks(`${R}/blob/hotfixes/a.md`, { repo: "CLDMV/x", from: "hotfixes", to: "v1.0.1" }), `${R}/blob/v1.0.1/a.md`);
assert.equal(releaseTitleVersion("release: v4.36.0 - fleet Node .gitignore template"), "4.36.0");
assert.equal(releaseTitleVersion("release: 1.2.3-rc.1"), "1.2.3-rc.1");
assert.equal(releaseTitleVersion("fix: release: v1.0.0"), "");
assert.equal(releaseTitleVersion("release: v1.2"), "");

// Release PRs keyed by title version, from the real llm-translator listing shape.
const closed = JSON.parse(readFileSync(new URL("./fixtures/llm-translator-closed-prs.json", import.meta.url), "utf8"));
const byVersion = indexReleasePrs(closed, "master");
assert.equal(byVersion.get("0.9.0")?.number, 149);
assert.equal(byVersion.get("0.1.0")?.number, 2);
assert.equal(byVersion.has("0.2.1"), false, "unmerged hotfix release PR #87 skipped");
assert.equal(byVersion.size, 10);
const recut = indexReleasePrs(
	[
		{ number: 5, title: "release: v1.0.0 - a", merged_at: "2026-01-01T00:00:00Z", base: { ref: "master" } },
		{ number: 7, title: "release: v1.0.0 - b", merged_at: "2026-02-01T00:00:00Z", base: { ref: "master" } },
		{ number: 8, title: "release: v1.1.0 - c", merged_at: "2026-02-01T00:00:00Z", base: { ref: "next" } },
		{ number: 9, title: "fix: release: v1.2.0", merged_at: "2026-02-01T00:00:00Z", base: { ref: "master" } }
	],
	"master"
);
assert.deepEqual(
	[...recut].map(([v, p]) => [v, p.number]),
	[["1.0.0", 7]]
);
assert.equal(indexReleasePrs(null, "master").size, 0);

console.log("release-notes: all checks passed");
