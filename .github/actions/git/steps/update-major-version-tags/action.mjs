/**
 * @fileoverview Derive major (vX) and minor (vX.Y) rolling tags from a
 * semantic version tag and emit the upsert-batch payload + summary JSON.
 * Node entrypoint for the update-major-version-tags step action.
 * @module @cldmv/.github.git.steps.update-major-version-tags
 */

import { execSync } from "node:child_process";
import { setOutput, setOutputs } from "../../../common/common/core.mjs";

try {
	const tagName = process.env.TAG_NAME || "";
	const debug = process.env.DEBUG === "true";
	console.log(`Processing tag: ${tagName}`);

	// Validate that this is a semantic version tag.
	const match = tagName.match(/^v(\d+)\.(\d+)\.(\d+)$/);
	if (!match) {
		console.log(`Tag ${tagName} is not a semantic version tag, skipping`);
		setOutput("updated", "false");
		setOutput(
			"summary-json",
			JSON.stringify({
				major_minor_updates: {
					title: "📌 Version Tags Updated",
					description: "No major/minor version tags updated - not a semantic version tag",
					updated: false,
					lines: [],
					stats_template: "📌 Major/minor tag updates: {count}"
				}
			})
		);
		process.exit(0);
	}

	const majorVersion = `v${match[1]}`;
	const minorVersion = `v${match[1]}.${match[2]}`;
	console.log(`Major version: ${majorVersion}`);
	console.log(`Minor version: ${minorVersion}`);

	// Resolve the commit the semantic tag points at.
	const tagSha = execSync(`git rev-list -n 1 "${tagName}"`).toString().trim();
	console.log(`Tag SHA: ${tagSha}`);

	const tagsPayload = JSON.stringify([
		{ tag: majorVersion, sha: tagSha, message: `${majorVersion} → ${tagName}` },
		{ tag: minorVersion, sha: tagSha, message: `${minorVersion} → ${tagName}` }
	]);

	console.log("🏷️ Updating version tags using upsert-batch:");
	if (debug) {
		console.log(tagsPayload);
	} else {
		console.log(`- ${majorVersion} -> ${tagName}`);
		console.log(`- ${minorVersion} -> ${tagName}`);
	}

	const summaryJson = JSON.stringify({
		major_minor_updates: {
			title: "📌 Version Tags Updated",
			description: "The following major/minor version tags have been updated:",
			updated: true,
			lines: [`- **${majorVersion}** → **${tagName}**`, `- **${minorVersion}** → **${tagName}**`],
			stats_template: "📌 Major/minor tag updates: {count}",
			notes: [`Workflows can reference major version tags (e.g., \`@${majorVersion}\`) for automatic updates.`]
		}
	});

	setOutputs({
		"tags-payload": tagsPayload,
		"major-version": majorVersion,
		"minor-version": minorVersion,
		updated: "true",
		"summary-json": summaryJson
	});
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
