#!/usr/bin/env node

/**
 * Resolve the GitHub Release body for this release.
 *
 * When the release commit carries a committed per-version changelog file
 * (`docs/changelog[s]/v<major>/v<version>.md`), that file is the release body:
 * the curated notes, not the squash-commit message. The coverage and
 * Contributors blocks from the commit-derived body are appended when the file
 * doesn't carry them. Without a file, the commit-derived body is kept, minus
 * the duplicated `release: vX.Y.Z - …` subject line and the squash trailers.
 *
 * Env:
 *   VERSION          resolved release version
 *   COMMIT_SHA       release commit
 *   TAG_NAME         release tag (used as the release name for subject stripping)
 *   GENERATED_BODY   commit-derived body from generate-comprehensive-changelog
 * Output: `body` (multiline)
 */

import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { buildReleaseBody, readChangelogAtRef } from "../../utilities/release-notes.mjs";

const version = process.env.VERSION || "";
const commitSha = process.env.COMMIT_SHA || "HEAD";
const tagName = process.env.TAG_NAME || (version ? `v${version}` : "");
const generated = process.env.GENERATED_BODY || "";

const file = readChangelogAtRef(version, commitSha, process.env.GITHUB_WORKSPACE || process.cwd());
if (file) {
	console.log(`📄 Using committed changelog ${file.path} as the release body.`);
} else {
	console.log(`ℹ️ No committed changelog file for v${version} at ${commitSha.slice(0, 7)} — using the commit-derived body.`);
}

const body = buildReleaseBody({ changelog: file?.content || "", baseBody: generated, name: tagName, version });

const out = process.env.GITHUB_OUTPUT;
if (out) {
	const delim = `EOF_${randomUUID()}`;
	appendFileSync(out, `body<<${delim}\n${body}\n${delim}\nsource=${file ? file.path : "commit"}\n`);
} else {
	console.log(body);
}
