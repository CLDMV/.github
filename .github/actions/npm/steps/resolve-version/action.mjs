/**
 * @fileoverview Resolve the version to display/use: the explicit new version
 * if given, otherwise the package.json version. Node entrypoint for the
 * resolve-version action.
 * @module @cldmv/.github.npm.steps.resolve-version
 */

import fs from "node:fs";
import { getInput, setOutput } from "../../../common/common/core.mjs";

try {
	let version = getInput("new-version");
	if (!version) {
		version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
	}
	setOutput("version", version);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
