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

	// Empty min-node-version explicitly means "no matrix" — run only
	// max_node_major + lts/*. Use this from workflows that don't need the
	// full per-version matrix (e.g. workflow-publish does a single final
	// confidence check, not a regression sweep). Aligns the implementation
	// with the input description that says "enables matrix when set."
	// See issue #2.
	const min = getInput("min-node-version");
	const maxInput = getInput("max-node-major");
	const max = maxInput ? Number.parseInt(maxInput, 10) : 22;
	const ltsOnly = getBooleanInput("lts-only-matrix");

	console.log(`🔍 DEBUG (build-and-test): min_node_version = '${min}'`);
	console.log(`🔍 DEBUG (build-and-test): max_node_major = '${maxInput}'`);

	if (!min) {
		const versions = [String(max), "lts/*"];
		const matrix = JSON.stringify(versions);
		console.log(`📍 min_node_version not set — running single max + lts: ${matrix}`);
		setOutput("matrix", matrix);
		process.exit(0);
	}

	const versions = [];
	let major = Number.parseInt(min.split(".")[0], 10);

	if (Number.isNaN(major)) {
		throw new Error(`min-node-version "${min}" is not a valid major or major.minor`);
	}

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
