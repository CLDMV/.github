/**
 * @fileoverview Unit tests for the package-manager resolver. Uses throwaway
 * temp dirs so no real repo state is touched. Run: `node test.mjs`.
 * @module @cldmv/.github.npm.utilities.detect-package-manager.test
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackageManager, installCommand, pmCommand, hasLockfile } from "./resolve.mjs";

let failures = 0;
function eq(name, got, want) {
	if (got === want) {
		console.log(`  ✅ ${name}`);
	} else {
		failures++;
		console.log(`  ❌ ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
	}
}

/** Build a temp dir seeded with the given files, run fn(dir), always clean up. */
function withRepo(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), "pm-detect-"));
	try {
		for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
		return fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("resolvePackageManager — explicit input overrides detection:");
withRepo({ "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }), "pnpm-lock.yaml": "" }, (dir) => {
	eq("explicit npm beats every pnpm signal", resolvePackageManager("npm", dir), "npm");
	eq("explicit yarn beats pnpm signal", resolvePackageManager("yarn", dir), "yarn");
	eq("explicit pnpm honored", resolvePackageManager("pnpm", dir), "pnpm");
	eq("explicit is case-insensitive", resolvePackageManager("PNPM", dir), "pnpm");
});

console.log("resolvePackageManager — auto precedence:");
withRepo({ "package.json": JSON.stringify({ packageManager: "pnpm@9.0.0" }), "yarn.lock": "" }, (dir) => {
	eq("packageManager field beats a conflicting lockfile", resolvePackageManager("auto", dir), "pnpm");
});
withRepo({ "package.json": JSON.stringify({ packageManager: "yarn@4.1.0" }) }, (dir) => {
	eq("packageManager field yarn", resolvePackageManager("auto", dir), "yarn");
});
withRepo({ "package.json": JSON.stringify({ name: "x" }), "pnpm-workspace.yaml": "packages:\n  - a" }, (dir) => {
	eq("pnpm-workspace.yaml (no lockfile) → pnpm", resolvePackageManager("auto", dir), "pnpm");
});
withRepo({ "package.json": JSON.stringify({ name: "x" }), "pnpm-lock.yaml": "" }, (dir) => {
	eq("pnpm-lock.yaml → pnpm", resolvePackageManager("auto", dir), "pnpm");
});
withRepo({ "package.json": JSON.stringify({ name: "x" }), "yarn.lock": "" }, (dir) => {
	eq("yarn.lock → yarn", resolvePackageManager("auto", dir), "yarn");
});
withRepo({ "package.json": JSON.stringify({ name: "x" }), "package-lock.json": "{}" }, (dir) => {
	eq("package-lock.json → npm", resolvePackageManager("auto", dir), "npm");
});
withRepo({ "package.json": JSON.stringify({ name: "x" }) }, (dir) => {
	eq("no signal at all → npm (back-compat)", resolvePackageManager("auto", dir), "npm");
	eq("empty input treated as auto → npm", resolvePackageManager("", dir), "npm");
	eq("unknown input treated as auto → npm", resolvePackageManager("bun", dir), "npm");
});
withRepo({ "package.json": "{ this is not json" }, (dir) => {
	eq("malformed package.json falls through to npm", resolvePackageManager("auto", dir), "npm");
});

console.log("installCommand:");
eq("pnpm frozen", installCommand("pnpm", true), "pnpm install --frozen-lockfile");
eq("pnpm plain (no lockfile)", installCommand("pnpm", false), "pnpm install");
eq("yarn frozen", installCommand("yarn", true), "yarn install --frozen-lockfile");
eq("yarn plain", installCommand("yarn", false), "yarn install");
eq("npm ci with lockfile", installCommand("npm", true), "npm ci");
eq("npm install without lockfile", installCommand("npm", false), "npm install");

console.log("hasLockfile:");
withRepo({ "pnpm-lock.yaml": "" }, (dir) => eq("pnpm lockfile present", hasLockfile("pnpm", dir), true));
withRepo({ "package.json": "{}" }, (dir) => eq("pnpm lockfile absent", hasLockfile("pnpm", dir), false));

console.log("pmCommand — leading-token rewrite:");
eq("npm is a no-op (byte-identical)", pmCommand("npm", "npm run build:ci"), "npm run build:ci");
eq("pnpm rewrites npm run", pmCommand("pnpm", "npm run build:ci"), "pnpm run build:ci");
eq("pnpm keeps --if-present suffix", pmCommand("pnpm", "npm run format --if-present"), "pnpm run format --if-present");
eq("yarn rewrites npm run", pmCommand("yarn", "npm run test"), "yarn run test");
eq("pnpm rewrites bare npm", pmCommand("pnpm", "npm"), "pnpm");
eq("pnpm rewrites npx → pnpm dlx", pmCommand("pnpm", "npx tsc"), "pnpm dlx tsc");
eq("yarn rewrites npx → yarn dlx", pmCommand("yarn", "npx tsc"), "yarn dlx tsc");
eq("non-npm command left alone", pmCommand("pnpm", "make build"), "make build");
eq("empty stays empty", pmCommand("pnpm", ""), "");

console.log(`\n${failures === 0 ? "✅ ALL PASS" : `❌ ${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
