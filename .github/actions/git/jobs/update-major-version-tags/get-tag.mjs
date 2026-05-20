/**
 * @fileoverview Resolve the semantic version tag to process — the release tag,
 * the package.json-derived tag (flagging when it must be created), or the
 * latest existing tag. Node delegation step of the update-major-version-tags job.
 * @module @cldmv/.github.git.jobs.update-major-version-tags.get-tag
 */

import fs from "node:fs";
import { execSync } from "node:child_process";
import { setOutput } from "../../../common/common/core.mjs";

try {
	const eventName = process.env.EVENT_NAME || "";
	let tagName;
	let needsCreate = "false";
	let tagSha = "";

	if (eventName === "release") {
		tagName = process.env.RELEASE_TAG || "";
		console.log(`Using release tag: ${tagName}`);
	} else {
		execSync("git fetch --tags --force", { stdio: "inherit" });

		// Source of truth: derive the expected tag from package.json.
		let pkgTag = "";
		if (fs.existsSync("package.json")) {
			let version = "";
			try {
				version = JSON.parse(fs.readFileSync("package.json", "utf8")).version || "";
			} catch {
				version = "";
			}
			if (version) {
				pkgTag = `v${version}`;
				console.log(`📦 Derived tag from package.json: ${pkgTag}`);
			}
		}

		const allTags = execSync("git tag -l").toString().split("\n").map((tag) => tag.trim());

		if (pkgTag) {
			tagName = pkgTag;
			if (allTags.includes(pkgTag)) {
				console.log(`✅ Tag ${pkgTag} exists — using it`);
			} else {
				console.log(`⚠️  Tag ${pkgTag} does not exist yet — will create it before updating major/minor aliases`);
				needsCreate = "true";
				tagSha = execSync("git rev-parse HEAD").toString().trim();
			}
		} else {
			console.log("⚠️  No package.json found, falling back to latest tag search");
			const latest = allTags
				.filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
				.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
				.pop();
			if (latest) {
				tagName = latest;
				console.log(`Found latest semantic version tag: ${tagName}`);
			} else {
				tagName = process.env.REF_NAME || "";
				console.log(`No semantic version tags found, using ref: ${tagName}`);
			}
		}
	}

	setOutput("tag-name", tagName);
	setOutput("needs-create", needsCreate);
	if (tagSha) setOutput("tag-sha", tagSha);
	console.log(`Processing tag: ${tagName}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
