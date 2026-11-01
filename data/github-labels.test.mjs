#!/usr/bin/env node
// Every label in data/github-labels.json must fit GitHub's documented limits
// (name 50, description 100 characters), or the org label sync fails for every
// repo with HTTP 422. Lengths are counted in code points, as GitHub counts them.
// Run: node data/github-labels.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME_MAX = 50;
const DESCRIPTION_MAX = 100;

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "github-labels.json");
const labels = JSON.parse(readFileSync(file, "utf8"));

const problems = [];
for (const label of labels) {
	const nameLength = [...label.name].length;
	const descriptionLength = [...(label.description ?? "")].length;
	if (nameLength > NAME_MAX) problems.push(`name of "${label.name}" is ${nameLength} characters (max ${NAME_MAX})`);
	if (descriptionLength > DESCRIPTION_MAX) {
		problems.push(`description of "${label.name}" is ${descriptionLength} characters (max ${DESCRIPTION_MAX})`);
	}
}
assert.deepEqual(problems, [], `github-labels.json exceeds GitHub label limits:\n  ${problems.join("\n  ")}`);

console.log(`All ${labels.length} labels within GitHub limits (name <= ${NAME_MAX}, description <= ${DESCRIPTION_MAX})`);
