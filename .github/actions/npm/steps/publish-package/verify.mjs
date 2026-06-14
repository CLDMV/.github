/**
 * @fileoverview Verify that the downloaded build artifact contains a usable
 * package directory before publishing, and — for satellite packages — that the
 * directory's package.json matches the name and version the workflow intends to
 * publish (the lockstep contract). Pre-publish step of the publish-package action.
 * @module @cldmv/.github.npm.steps.publish-package.verify
 */

import fs from "node:fs";

// Directory within the downloaded artifact to publish from. Defaults to
// package-contents (the core package); satellites pass their own staged dir.
const packageDir = process.env.PACKAGE_DIR || "package-contents";
const expectedName = process.env.EXPECTED_NAME || "";
const expectedVersion = process.env.EXPECTED_VERSION || "";

console.log(`📦 Verifying package contents from artifacts (${packageDir})...`);

if (!(fs.existsSync(packageDir) && fs.statSync(packageDir).isDirectory())) {
	console.error(`::error::Package contents directory not found in artifacts: ${packageDir}`);
	console.log("Available files:");
	for (const name of fs.readdirSync(".")) console.log(`  ${name}`);
	process.exit(1);
}

console.log(`✅ Package contents directory found in artifacts: ${packageDir}`);
console.log(`📋 Files in ${packageDir}:`);
for (const name of fs.readdirSync(packageDir)) console.log(`  ${name}`);

const pkgPath = `${packageDir}/package.json`;
if (!fs.existsSync(pkgPath)) {
	console.error(`::error::No package.json found in ${packageDir}`);
	process.exit(1);
}

// For satellite packages (a non-default package-dir) enforce the lockstep
// contract: the directory's package.json must match the name and version the
// workflow is about to publish and tag. A stale or un-stamped satellite dir
// would otherwise publish a different version than the tag/release records.
// The core package (package-contents) keeps its prior behavior — it is the
// npm-packed repo root and is already the source of truth for its own version
// (which a manual version override may legitimately differ from).
if (packageDir !== "package-contents" && (expectedName || expectedVersion)) {
	let pkg;
	try {
		pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
	} catch (error) {
		console.error(`::error::Could not parse ${pkgPath}: ${error.message}`);
		process.exit(1);
	}
	if (expectedName && pkg.name !== expectedName) {
		console.error(`::error::Lockstep check failed: ${pkgPath} name is "${pkg.name}" but the workflow expects "${expectedName}"`);
		process.exit(1);
	}
	if (expectedVersion && pkg.version !== expectedVersion) {
		console.error(
			`::error::Lockstep check failed: ${pkgPath} version is "${pkg.version}" but the workflow expects "${expectedVersion}" — the satellite build likely did not stamp the core version.`
		);
		process.exit(1);
	}
	console.log(`🔒 Lockstep verified: ${pkg.name}@${pkg.version} matches the requested publish.`);
}
