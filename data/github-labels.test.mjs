#!/usr/bin/env node
// Every label in data/github-labels.json must fit GitHub's label limits (name 50
// and description 100 characters, colour 6 hex digits), and no name or alias may
// belong to two labels. A bad entry makes the org label sync fail before it
// touches any repo. The checks live in the sync's own validator, so this test
// and the sync can't drift apart.
// Run: node data/github-labels.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DESCRIPTION_MAX, NAME_MAX, validateLabelCatalog } from "../.github/actions/github/jobs/sync-org-labels/validate-catalog.mjs";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "github-labels.json");
const labels = JSON.parse(readFileSync(file, "utf8"));

const problems = validateLabelCatalog(labels);
assert.deepEqual(problems, [], `github-labels.json breaks GitHub label limits:\n  ${problems.join("\n  ")}`);

// The validator itself catches each kind of bad entry.
const ok = { name: "type: bug", color: "d73a4a", description: "Something isn't working", aliases: ["bug"] };
assert.deepEqual(validateLabelCatalog([ok]), []);
assert.equal(validateLabelCatalog([{ ...ok, name: "x".repeat(NAME_MAX + 1) }]).length, 1, "long name");
assert.equal(validateLabelCatalog([{ ...ok, description: "é".repeat(DESCRIPTION_MAX + 1) }]).length, 1, "long description (code points)");
assert.deepEqual(validateLabelCatalog([{ ...ok, description: "é".repeat(DESCRIPTION_MAX) }]), [], "100 code points fits");
assert.equal(validateLabelCatalog([{ ...ok, color: "#d73a4a" }]).length, 1, "colour with #");
assert.equal(validateLabelCatalog([{ ...ok, color: "d73a4" }]).length, 1, "short colour");
assert.equal(validateLabelCatalog([{ ...ok, name: "" }]).length, 1, "missing name");
assert.equal(validateLabelCatalog([ok, { ...ok, name: "Type: Bug", aliases: [] }]).length, 1, "duplicate name, case-insensitive");
assert.equal(validateLabelCatalog([ok, { ...ok, name: "defect", aliases: ["BUG"] }]).length, 1, "alias owned by two labels");
assert.deepEqual(validateLabelCatalog([{ ...ok, aliases: ["Type: Bug"] }]), [], "an alias equal to its own name is harmless");
assert.equal(validateLabelCatalog({}).length, 1, "not an array");

console.log(
	`All ${labels.length} labels valid (name <= ${NAME_MAX}, description <= ${DESCRIPTION_MAX}, 6-hex colour, unique names/aliases)`
);
