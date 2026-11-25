import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_BRANCH_PATTERNS, BUILDERS, DEFAULT_BOT_APP_ID, DEFAULT_OPTS, buildAll, buildBranchNaming } from "./builders.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

// buildAll returns all four rulesets, and BUILDERS (the generator UI) lists the same keys.
const all = buildAll();
assert.deepEqual(Object.keys(all), ["master", "next", "hotfixes", "naming"]);
assert.deepEqual(Object.keys(BUILDERS), Object.keys(all));
assert.equal(new Set(Object.values(all).map((r) => r.name)).size, 4, "ruleset names must be unique (bootstrap matches by name)");

// Branch Naming: every branch, minus the allowed patterns, creation blocked.
const naming = buildBranchNaming(DEFAULT_OPTS);
assert.equal(naming.name, "Branch Naming");
assert.deepEqual(naming.conditions.ref_name.include, ["~ALL"]);
assert.deepEqual(
	naming.conditions.ref_name.exclude,
	ALLOWED_BRANCH_PATTERNS.map((p) => `refs/heads/${p}`)
);
assert.deepEqual(naming.rules, [{ type: "creation" }]);
assert.deepEqual(
	naming.bypass_actors.map((a) => a.actor_type),
	["OrganizationAdmin", "Integration"]
);
assert.equal(naming.bypass_actors[1].actor_id, DEFAULT_BOT_APP_ID);
assert.deepEqual(
	buildBranchNaming({ includeBot: false }).bypass_actors.map((a) => a.actor_type),
	["OrganizationAdmin"]
);

// Patterns are fnmatch, not regex: a `+` or `\.` would never match a real name.
for (const p of ALLOWED_BRANCH_PATTERNS) assert.doesNotMatch(p, /[+\\]/, `${p} looks like a regex`);

// Branches the flow itself relies on are allowed.
for (const p of ["master", "main", "next", "hotfixes", "dev", "badges", "gh-pages", "dependabot/**", "copilot/**", "wip/**"]) {
	assert.ok(ALLOWED_BRANCH_PATTERNS.includes(p), `${p} missing`);
}

// Every prefix feature-pr.yml auto-PRs is creatable.
const featurePr = fs.readFileSync(path.join(root, ".github/workflows/workflow-feature-pr.yml"), "utf8");
const prefixes = [...featurePr.matchAll(/^\s+([a-z|/*]+)\)\s+target="(?:next|hotfixes)"/gm)].flatMap((m) =>
	m[1].split("|").map((s) => s.replace(/\/\*$/, ""))
);
assert.ok(prefixes.length >= 12, `parsed ${prefixes.length} auto-PR prefixes`);
for (const prefix of prefixes) {
	assert.ok(
		ALLOWED_BRANCH_PATTERNS.some((p) => p.startsWith(`${prefix}/`)),
		`feature-pr.yml auto-PRs ${prefix}/* but the ruleset blocks creating it`
	);
}

// data/rulesets/naming.json is the import-ready copy and must match the builder.
const committed = JSON.parse(fs.readFileSync(path.join(root, "data/rulesets/naming.json"), "utf8"));
assert.deepEqual(committed, naming, "data/rulesets/naming.json is stale; regenerate it from buildBranchNaming(DEFAULT_OPTS)");

console.log("builders.test.mjs: ok");
