/**
 * @fileoverview Extract the npm-pack .tgz into a package-contents/ directory
 * so later steps can access package files directly. Node delegation step of
 * the build-and-test action.
 * @module @cldmv/.github.npm.jobs.build-and-test.extract-contents
 */

import fs from "node:fs";
import { execSync } from "node:child_process";

/**
 * Recursively find the first .tgz file under a directory, skipping VCS and
 * dependency directories.
 * @param {string} dir - Directory to search.
 * @returns {string|undefined} First matching path, or undefined.
 */
function findTgz(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === ".git" || entry.name === "node_modules") continue;
		const full = `${dir}/${entry.name}`;
		if (entry.isDirectory()) {
			const found = findTgz(full);
			if (found) return found;
		} else if (entry.isFile() && entry.name.endsWith(".tgz")) {
			return full;
		}
	}
	return undefined;
}

try {
	console.log("📦 Extracting npm package contents for easier access...");

	// npm pack writes the .tgz to the repo root; fall back to a recursive search.
	const tgzFile = fs
		.readdirSync(".")
		.filter((name) => name.endsWith(".tgz"))
		.sort()[0] || findTgz(".");

	if (!tgzFile) {
		console.error("::error::No .tgz file found");
		process.exit(1);
	}
	console.log(`📦 Found package file: ${tgzFile}`);

	fs.mkdirSync("package-contents", { recursive: true });
	execSync(`tar -xzf "${tgzFile}" -C package-contents --strip-components=1`, { stdio: "inherit" });

	console.log("📂 Package contents extracted to package-contents/");
	console.log("📋 Extracted files:");
	for (const name of fs.readdirSync("package-contents")) console.log(`  ${name}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
