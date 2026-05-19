/**
 * @fileoverview Build .tar.gz and .zip release archives from a package's
 * contents (a package-contents directory or an npm-pack .tgz). Node entrypoint
 * for the create-package-files action.
 * @module @cldmv/.github.npm.steps.create-package-files
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { getInput, setOutput } from "../../../common/common/core.mjs";

/**
 * Recursively collect every file path under a directory.
 * @param {string} dir - Directory to walk.
 * @param {string[]} [out] - Accumulator.
 * @returns {string[]} All file paths found.
 */
function walkFiles(dir, out = []) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(full, out);
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

/** Check whether a path exists and is a directory. */
const isDir = (p) => fs.existsSync(p) && fs.statSync(p).isDirectory();

try {
	const packagePathInput = getInput("package-path", { default: "*.tgz" });

	console.log("📦 Creating release package files...");

	// Prefer an already-extracted package-contents directory; fall back to a .tgz.
	let packageDir;
	let packageJsonPath;
	let tempDir = "";

	if (isDir("package-contents")) {
		console.log("✅ Using package-contents from current directory");
		packageDir = "package-contents";
		packageJsonPath = path.resolve("package-contents/package.json");
	} else if (isDir("artifacts/package-contents")) {
		console.log("✅ Using package-contents from artifacts directory");
		packageDir = "artifacts/package-contents";
		packageJsonPath = path.resolve("artifacts/package-contents/package.json");
	} else {
		console.log("📦 Extracting from .tgz file as fallback...");
		let tgzFile = "";

		// First honour an explicit package-path input.
		if (packagePathInput && packagePathInput !== "*.tgz") {
			if (path.isAbsolute(packagePathInput)) {
				if (fs.existsSync(packagePathInput)) {
					tgzFile = packagePathInput;
					console.log(`📦 Found .tgz file with absolute path: ${tgzFile}`);
				}
			} else {
				const globRe = new RegExp("^" + packagePathInput.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
				tgzFile = walkFiles(".")
					.map((f) => path.relative(".", f))
					.find((f) => globRe.test(f) || globRe.test("./" + f)) || "";
				if (tgzFile) console.log(`📦 Found .tgz file with relative path pattern: ${tgzFile}`);
			}
		}

		// Otherwise scan common locations for any .tgz.
		if (!tgzFile) {
			for (const location of ["./artifacts", ".", "./dist", "./build"]) {
				const found = walkFiles(location).find((f) => f.endsWith(".tgz"));
				if (found) {
					tgzFile = found;
					console.log(`📦 Found .tgz file in ${location}: ${tgzFile}`);
					break;
				}
			}
		}

		if (!tgzFile) {
			console.log("❌ No .tgz file found. Searched in:");
			console.log(`  - Custom pattern: ${packagePathInput}`);
			console.log("  - ./artifacts/, ./ , ./dist/, ./build/");
			console.error("::error::No .tgz file found");
			process.exit(1);
		}

		console.log(`📦 Found npm pack file: ${tgzFile}`);
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpf-extract-"));
		console.log("📂 Extracting npm pack contents...");
		execSync(`tar -xzf "${tgzFile}" -C "${tempDir}"`, { stdio: "inherit" });
		packageDir = path.join(tempDir, "package");
		packageJsonPath = path.join(tempDir, "package", "package.json");
	}

	const packageName = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).name;
	console.log(`📦 Package name: ${packageName}`);
	console.log(`📂 Package directory: ${packageDir}`);

	// Clean name for filenames (drop @, turn / into -).
	const cleanName = packageName.replace(/@/g, "").replace(/\//g, "-");
	const tarGzPath = `${cleanName}-production.tar.gz`;
	const zipPath = `${cleanName}-production.zip`;

	// Stage the contents under a directory named after the package (scoped-aware).
	const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpf-build-"));
	const finalPackageDir = path.join(buildDir, packageName);
	fs.mkdirSync(finalPackageDir, { recursive: true });
	console.log(`📁 Creating package structure: ${finalPackageDir}`);
	fs.cpSync(packageDir, finalPackageDir, { recursive: true });

	console.log("Creating tar.gz file...");
	execSync(`tar -czf "${tarGzPath}" -C "${buildDir}" "${packageName}"`, { stdio: "inherit" });

	console.log("Creating zip file...");
	const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
	execSync(`zip -r "${path.join(workspace, zipPath)}" "${packageName}"`, { stdio: "inherit", cwd: buildDir });

	// Clean up temp directories.
	fs.rmSync(buildDir, { recursive: true, force: true });
	if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });

	const tarGzAbs = path.resolve(tarGzPath);
	const zipAbs = path.resolve(zipPath);
	console.log("✅ Created package files:");
	console.log(`  - TAR.GZ: ${tarGzAbs}`);
	console.log(`  - ZIP: ${zipAbs}`);

	setOutput("tar-gz-path", tarGzAbs);
	setOutput("zip-path", zipAbs);
	setOutput("clean-name", cleanName);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
