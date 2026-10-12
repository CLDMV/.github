#!/usr/bin/env node
/**
 * @fileoverview Unit tests for the deps-only range classifier. Run: `node deps-only.test.mjs`.
 */

import { classifyDepsOnly, manifestChangeIsDevOnly, isLockOrCiPath } from "./deps-only.mjs";

let failures = 0;
function eq(actual, expected, label) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) console.log(`  ✅ ${label}`);
	else {
		console.error(`  ❌ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

const base = {
	name: "x",
	version: "1.0.0",
	dependencies: { a: "^1" },
	devDependencies: { t: "^1" },
	files: ["dist"],
	scripts: { test: "t" }
};

console.log("isLockOrCiPath:");
eq(isLockOrCiPath("package-lock.json"), true, "package-lock.json");
eq(isLockOrCiPath("pnpm-lock.yaml"), true, "pnpm-lock.yaml");
eq(isLockOrCiPath(".github/workflows/ci.yml"), true, "workflow");
eq(isLockOrCiPath(".github/dependabot.yml"), true, "dependabot.yml");
eq(isLockOrCiPath("npm-shrinkwrap.json"), false, "npm-shrinkwrap.json ships");
eq(isLockOrCiPath("src/.github/x"), false, "nested .github is not CI config");

console.log("\nmanifestChangeIsDevOnly:");
eq(manifestChangeIsDevOnly(base, { ...base, devDependencies: { t: "^2" } }), true, "devDependencies bump");
eq(manifestChangeIsDevOnly(base, { ...base, version: "1.0.1", devDependencies: { t: "^2" } }), true, "version bump + devDependencies");
eq(manifestChangeIsDevOnly(base, { ...base, dependencies: { a: "^2" } }), false, "dependencies bump");
eq(manifestChangeIsDevOnly(base, { ...base, peerDependencies: { p: "*" } }), false, "peerDependencies added");
eq(manifestChangeIsDevOnly(base, { ...base, optionalDependencies: { o: "*" } }), false, "optionalDependencies added");
eq(manifestChangeIsDevOnly(base, { ...base, files: ["dist", "src"] }), false, "files changed");
eq(manifestChangeIsDevOnly(base, { ...base, exports: "./x.js" }), false, "exports added");
eq(manifestChangeIsDevOnly(base, { ...base, scripts: { test: "u" } }), false, "scripts changed");
eq(manifestChangeIsDevOnly(null, base), false, "missing base manifest");
eq(manifestChangeIsDevOnly(base, null), false, "missing head manifest");

console.log("\nclassifyDepsOnly:");
const dev = { ...base, devDependencies: { t: "^2" } };
eq(classifyDepsOnly({ files: ["package.json", "package-lock.json"], baseManifest: base, headManifest: dev }), true, "devDeps + lockfile");
eq(classifyDepsOnly({ files: [".github/workflows/ci.yml"], baseManifest: base, headManifest: base }), true, "CI only");
eq(
	classifyDepsOnly({ files: ["package-lock.json", "src/index.mjs"], baseManifest: base, headManifest: base }),
	false,
	"shipped source joins"
);
eq(
	classifyDepsOnly({ files: ["package.json"], baseManifest: base, headManifest: { ...dev, dependencies: {} } }),
	false,
	"dependencies change"
);
eq(classifyDepsOnly({ files: ["docs/changelogs/v1.0.1.md"], baseManifest: base, headManifest: base }), false, "changelog doc joins");
eq(classifyDepsOnly({ files: [], baseManifest: base, headManifest: base }), false, "empty range");

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll deps-only tests passed");
