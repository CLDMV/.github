/**
 * @fileoverview Build the Node.js test matrix as a JSON array — from the
 * minimum major (or major.minor) up to the maximum major, plus "lts/*" — with
 * skip-matrix and LTS-only modes. Node entrypoint for the generate-matrix action.
 * @module @cldmv/.github.node.steps.generate-matrix
 */

import { getInput, getBooleanInput, setOutput } from "../../../common/common/core.mjs";

try {
	// Skip mode: a single version, no matrix.
	if (getBooleanInput("skip-matrix-tests")) {
		const single = getInput("node-version", { default: "lts/*" });
		console.log(`📍 Matrix testing skipped, using single version: ${single}`);
		setOutput("matrix", JSON.stringify([single]));
		process.exit(0);
	}

	const min = getInput("min-node-version", { default: "20" });
	const maxInput = getInput("max-node-major");
	const max = maxInput ? Number.parseInt(maxInput, 10) : 22;
	const ltsOnly = getBooleanInput("lts-only-matrix");

	console.log(`🔍 DEBUG (build-and-test): min_node_version = '${min}'`);
	console.log(`🔍 DEBUG (build-and-test): max_node_major = '${maxInput}'`);

	const versions = [];
	let major = Number.parseInt(min.split(".")[0], 10);

	// A "major.minor" minimum keeps that exact entry, then iterates by major.
	if (min.includes(".")) {
		versions.push(`${major}.${min.split(".")[1]}`);
		major++;
	}
	while (major <= max) {
		if (ltsOnly && major % 2 !== 0) {
			console.log(`⏭️  Skipping non-LTS Node.js v${major} (odd major)`);
		} else {
			versions.push(String(major));
		}
		major++;
	}
	versions.push("lts/*");

	const matrix = JSON.stringify(versions);
	console.log(`📊 Matrix testing enabled with versions: ${matrix}`);
	setOutput("matrix", matrix);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
