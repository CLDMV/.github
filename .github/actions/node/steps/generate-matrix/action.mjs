/**
 * @fileoverview Build the Node.js test matrix as a JSON array — from the
 * minimum major (or major.minor) up to the maximum major, plus "lts/*" — with
 * skip-matrix and LTS-only modes. Node entrypoint for the generate-matrix action.
 * @module @cldmv/.github.node.steps.generate-matrix
 */

import { getInput, getBooleanInput, setOutput } from "../../../common/common/core.mjs";

/**
 * Extract the Node.js major from a resolved version string (`"24.9.0"`, `"v24.9.0"`, or a bare
 * `"24"`). Used to compare `lts/*`'s actual resolved major against the matrix's own explicit entries.
 * @param {string} version - Resolved version string.
 * @returns {number|null} The major, or null when `version` is empty/unparseable.
 */
function parseMajor(version) {
	const m = String(version || "")
		.trim()
		.match(/^v?(\d+)/);
	return m ? Number.parseInt(m[1], 10) : null;
}

/**
 * Build the Node.js version matrix. Pure (no I/O beyond `console.log`) so it's directly testable; the
 * CLI section below is a thin wrapper that reads inputs and writes the `matrix` output.
 *
 * `currentLtsVersion` is the ACTUAL resolved `lts/*` version — e.g. `actions/setup-node`'s own
 * `node-version` output from a step that installed `lts/*` — not a guess. Node's Active-LTS major
 * changes over time (historically every October, six months after that major's April release), and
 * when the matrix's own explicit sweep already reaches that major, an explicit numeric entry and the
 * `"lts/*"` sentinel resolve to the IDENTICAL install — e.g. `max-node-major: 26` once Node 26 is
 * Active LTS would run `["...", "26", "lts/*"]` where the last two entries are the same Node version
 * under two labels. To drop the duplicate CI job we remove the redundant NUMERIC entry and KEEP
 * `"lts/*"` (replacing the numeric with the sentinel in place) — NOT the other way round. The publish
 * flow's `calculate-names` downloads the build artifact by the fixed name `build-artifacts-lts`, and
 * that artifact is produced ONLY by the matrix leg whose input is literally `"lts/*"` (see
 * build-and-test's get-node-version label). Dropping `"lts/*"` instead would delete that artifact and
 * break every publish with "Artifact not found for name: build-artifacts-lts". A hardcoded
 * promotion-date table could dedup without the extra `setup-node` call, but Node's schedule is an
 * external fact this workflow shouldn't have to track/update by hand — reading the real resolution is
 * exact and self-updating. An empty/unresolvable `currentLtsVersion` disables the dedup (never treat
 * "unknown" as "duplicate") — both the numeric entry and `"lts/*"` are kept in that case.
 * @param {object} opts
 * @param {string} opts.min - `min-node-version` input, raw. Empty = "no matrix" (single max + lts).
 * @param {string} opts.maxInput - `max-node-major` input, raw. Empty = default max of 26.
 * @param {boolean} opts.ltsOnly - `lts-only-matrix` input — only even (LTS-track) majors in the sweep.
 * @param {string} [opts.currentLtsVersion] - Resolved `lts/*` version, e.g. from `actions/setup-node`.
 * @returns {string[]} Matrix version strings.
 * @throws {Error} When `min` is set but not a valid major or major.minor.
 */
function buildMatrix({ min, maxInput, ltsOnly, currentLtsVersion }) {
	const max = maxInput ? Number.parseInt(maxInput, 10) : 26;
	const lts = parseMajor(currentLtsVersion);

	// Empty min-node-version explicitly means "no matrix" — run only
	// max_node_major + lts/*. Use this from workflows that don't need the
	// full per-version matrix (e.g. workflow-publish does a single final
	// confidence check, not a regression sweep). Aligns the implementation
	// with the input description that says "enables matrix when set."
	// See issue #2.
	if (!min) {
		if (lts !== null && lts === max) {
			// max and lts/* install the same Node — keep lts/* (the publish flow's
			// build-artifacts-lts artifact is produced only by the lts/* leg) and drop the
			// redundant explicit max.
			console.log(`⏭️  Dropping redundant explicit v${max} — same install as lts/* (keeping lts/* for build-artifacts-lts)`);
			return ["lts/*"];
		}
		return [String(max), "lts/*"];
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

	const ltsIdx = lts !== null ? versions.indexOf(String(lts)) : -1;
	if (ltsIdx !== -1) {
		// lts/* installs a major already swept in explicitly — replace that numeric entry
		// with the lts/* sentinel (same install, one label) rather than appending a second
		// leg. Keep lts/*, not the numeric: the publish flow's build-artifacts-lts artifact
		// is produced only by the lts/* leg, so dropping lts/* would break every publish.
		console.log(`⏭️  Replacing explicit v${lts} with lts/* — same install; preserves the build-artifacts-lts artifact`);
		versions[ltsIdx] = "lts/*";
	} else {
		versions.push("lts/*");
	}

	return versions;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		// Skip mode: a single version, no matrix.
		if (getBooleanInput("skip-matrix-tests")) {
			const single = getInput("node-version", { default: "lts/*" });
			console.log(`📍 Matrix testing skipped, using single version: ${single}`);
			setOutput("matrix", JSON.stringify([single]));
			process.exit(0);
		}

		const min = getInput("min-node-version");
		const maxInput = getInput("max-node-major");
		const ltsOnly = getBooleanInput("lts-only-matrix");
		const currentLtsVersion = getInput("current-lts-version");

		console.log(`🔍 DEBUG (build-and-test): min_node_version = '${min}'`);
		console.log(`🔍 DEBUG (build-and-test): max_node_major = '${maxInput}'`);

		const versions = buildMatrix({ min, maxInput, ltsOnly, currentLtsVersion });
		const matrix = JSON.stringify(versions);
		if (!min) {
			console.log(`📍 min_node_version not set — running single max + lts: ${matrix}`);
		} else {
			console.log(`📊 Matrix testing enabled with versions: ${matrix}`);
		}
		setOutput("matrix", matrix);
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}

// Export functions for testing
export { buildMatrix, parseMajor };
