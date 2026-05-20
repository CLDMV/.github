/**
 * @fileoverview Output the running Node.js version (normalized, no leading "v")
 * and a label (the input label, or the version). Node entrypoint for the
 * get-node-version action.
 * @module @cldmv/.github.node.steps.get-node-version
 */

import { execSync } from "node:child_process";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	const version = execSync("node --version").toString().trim().replace(/^v/, "");
	setOutput("node-version", version);
	setOutput("node-label", getInput("label") || version);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
