/**
 * @fileoverview Calculate dynamic artifact and release names from the Node.js
 * version and package metadata. Node entrypoint for the calculate-names action.
 * @module @cldmv/.github.common.steps.calculate-names
 */

import { getInput, setOutputs } from "../../common/common/core.mjs";

try {
	const nodeVersion = getInput("node-version", { default: "lts/*" });
	const version = getInput("version", { required: true });

	let artifactName;
	let versionSuffix;
	if (nodeVersion === "lts/*") {
		artifactName = "build-artifacts-lts";
		versionSuffix = "";
	} else {
		// Convert a version like "18.x" to "18" or "16.4.x" to "16.4".
		const versionClean = nodeVersion.replace(/\.x$/, "").replace(/\*$/, "");
		artifactName = `build-artifacts-${versionClean}`;
		versionSuffix = ` (Node.js ${versionClean})`;
	}

	// Release name is just the version; the package name is redundant in repo context.
	const releaseName = `v${version}${versionSuffix}`;

	setOutputs({ "artifact-name": artifactName, "release-name": releaseName });
	console.log(`📦 Artifact name: ${artifactName}`);
	console.log(`🏷️ Release name: ${releaseName}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
