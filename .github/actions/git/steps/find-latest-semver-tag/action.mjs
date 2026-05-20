/**
 * @fileoverview Find the highest vX.Y.Z tag from a detailed tags JSON array.
 * Node entrypoint for the find-latest-semver-tag action.
 * @module @cldmv/.github.git.steps.find-latest-semver-tag
 */

import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	console.log("Processing tags from detailed output...");

	let tags = [];
	try {
		tags = JSON.parse(getInput("tags-json", { required: true }));
	} catch {
		tags = [];
	}

	const latestTag = (Array.isArray(tags) ? tags : [])
		.map((tag) => tag?.name)
		.filter((name) => /^v\d+\.\d+\.\d+$/.test(name || ""))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
		.pop();

	if (latestTag) {
		console.log(`Found latest semantic version tag: ${latestTag}`);
		setOutput("tag-name", latestTag);
		setOutput("has-tag", "true");
	} else {
		console.log("No semantic version tags found");
		setOutput("has-tag", "false");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
