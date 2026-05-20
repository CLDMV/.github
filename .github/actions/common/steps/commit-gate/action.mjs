/**
 * @fileoverview Check whether the triggering commit message starts with any of
 * a set of prefixes, to gate conditional workflow execution. Node entrypoint
 * for the commit-gate action.
 * @module @cldmv/.github.common.steps.commit-gate
 */

import { getInput, getEventPayload, setOutputs } from "../../../common/common/core.mjs";

try {
	// Use the explicit input, falling back to the push event's head commit.
	let commitMsg = getInput("commit_message");
	if (!commitMsg) {
		commitMsg = getEventPayload().head_commit?.message || "";
	}
	console.log(`Checking commit message: ${commitMsg}`);

	const prefixes = getInput("prefixes", { required: true })
		.split(",")
		.map((prefix) => prefix.trim())
		.filter(Boolean);

	let shouldSkip = "false";
	let matchedPrefix = "";
	for (const prefix of prefixes) {
		console.log(`Checking prefix: '${prefix}'`);
		if (commitMsg.startsWith(prefix)) {
			console.log(`✅ Commit message starts with '${prefix}'`);
			shouldSkip = "true";
			matchedPrefix = prefix;
			break;
		}
	}

	if (shouldSkip === "false") {
		console.log("❌ Commit message does not start with any specified prefix");
	}

	setOutputs({ should_skip: shouldSkip, matched_prefix: matchedPrefix });
	console.log(`Final result: should_skip=${shouldSkip}, matched_prefix=${matchedPrefix}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
