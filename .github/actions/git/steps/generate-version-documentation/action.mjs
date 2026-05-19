/**
 * @fileoverview Create or update VERSION_TAGS.md documenting the current major
 * version tag mappings, committing the change if the file differs. Node
 * entrypoint for the generate-version-documentation action.
 * @module @cldmv/.github.git.steps.generate-version-documentation
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { getInput, getEventPayload } from "../../../common/common/core.mjs";

/** Compare two version-ish strings the way `sort -V` would. */
const versionCompare = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** Run a git command and return trimmed stdout. */
const git = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

try {
	if (getInput("create-documentation", { default: "true" }) !== "true") {
		console.log("Skipping version documentation (create-documentation != 'true')");
		process.exit(0);
	}

	const lines = [
		"# Version Tags",
		"",
		"This repository uses semantic versioning with automated major version tag updates.",
		"",
		"## Current Major Versions",
		""
	];

	// List all major version tags (vN) and map each to its latest patch.
	const majorTags = git("git tag -l 'v[0-9]*'")
		.split("\n")
		.map((tag) => tag.trim())
		.filter((tag) => /^v\d+$/.test(tag))
		.sort(versionCompare);

	for (const majorTag of majorTags) {
		const patches = git(`git tag -l '${majorTag}.*'`)
			.split("\n")
			.map((tag) => tag.trim())
			.filter(Boolean)
			.sort(versionCompare);
		const latestPatch = patches[patches.length - 1];
		lines.push(latestPatch ? `- \`${majorTag}\` → \`${latestPatch}\`` : `- \`${majorTag}\` → \`${majorTag}\``);
	}

	lines.push(
		"",
		"## Usage",
		"",
		"Reference workflows using major version tags for automatic updates:",
		"",
		"```yaml",
		"jobs:",
		"  ci:",
		"    uses: CLDMV/.github/workflows/ci.yml@v2",
		"```",
		"",
		"Or use specific versions for stability:",
		"",
		"```yaml",
		"jobs:",
		"  ci:",
		"    uses: CLDMV/.github/workflows/ci.yml@v2.0.1",
		"```",
		"",
		"Major version tags are automatically updated when new patch/minor releases are published."
	);

	fs.writeFileSync("VERSION_TAGS.md", lines.join("\n") + "\n");

	// Commit the documentation if it changed.
	let changed = false;
	try {
		execSync("git diff --quiet VERSION_TAGS.md", { stdio: "ignore" });
	} catch {
		changed = true;
	}

	if (changed) {
		execSync('git config --local user.email "action@github.com"');
		execSync('git config --local user.name "GitHub Action"');
		execSync("git add VERSION_TAGS.md");
		execSync('git commit -m "docs: update version tags documentation"', { stdio: "inherit" });

		// Resolve the branch to push to — never push to an empty "HEAD:" target.
		let targetBranch = getEventPayload().repository?.default_branch || "";
		if (!targetBranch) {
			try {
				targetBranch = execSync("git symbolic-ref --short refs/remotes/origin/HEAD", { stdio: ["ignore", "pipe", "ignore"] })
					.toString()
					.trim()
					.replace(/^origin\//, "");
			} catch {
				targetBranch = "";
			}
		}
		if (!targetBranch) targetBranch = process.env.GITHUB_REF_NAME || "";

		if (targetBranch) {
			execSync(`git push origin HEAD:${targetBranch}`, { stdio: "inherit" });
		} else {
			console.log("::warning::Could not determine the default branch — skipping VERSION_TAGS.md push");
		}
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
