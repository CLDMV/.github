/**
 * @fileoverview Calculate dynamic artifact and release names from the Node.js
 * version and package metadata. Node entrypoint for the calculate-names action.
 * @module @cldmv/.github.common.steps.calculate-names
 */

import fs from "node:fs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

try {
	const nodeVersion = getInput("node-version", { default: "lts/*" });
	const version = getInput("version", { required: true });
	const packageName = getInput("package-name", { default: "" });

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

	// The package name is redundant in the release title ONLY when it's the
	// repo's own package (repo == package, e.g. the core release for
	// @cldmv/slothlet). A satellite package (dist-packages/<name>/, e.g.
	// @cldmv/slothlet-i18n) shares the repo but is a DIFFERENT npm package, so
	// its release title must say which one it is — otherwise every satellite
	// release is titled identically to the core release and to each other
	// (see docs/conventions/satellite-packages.md).
	let repoPackageName = "";
	try {
		repoPackageName = JSON.parse(fs.readFileSync("package.json", "utf8")).name || "";
	} catch {
		// No root package.json readable — treat as core (no prefix) rather than fail the release.
	}
	const isSatellite = Boolean(packageName) && packageName !== repoPackageName;
	const releaseName = `${isSatellite ? `${packageName} ` : ""}v${version}${versionSuffix}`;

	setOutputs({ "artifact-name": artifactName, "release-name": releaseName });
	console.log(`📦 Artifact name: ${artifactName}`);
	console.log(`🏷️ Release name: ${releaseName}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
