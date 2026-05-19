/**
 * @fileoverview Detect orphaned major (vX) and minor (vX.Y) version tags —
 * those not pointing at their latest patch — and emit a payload for the
 * upsert-batch fixer. Node delegation step of the fix-orphaned-version-tags job.
 * @module @cldmv/.github.git.jobs.fix-orphaned-version-tags.gather
 */

import { execSync } from "node:child_process";
import { setOutput } from "../../../common/common/core.mjs";

/** Run a git command and return trimmed stdout. */
const sh = (cmd) => execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] }).toString().trim();

try {
	// Ensure tags are up to date (checkout already used fetch-depth: 0).
	try {
		sh("git fetch --prune --tags --force");
	} catch {
		// Non-fatal.
	}

	console.log("🔍 Checking for orphaned major and minor version tags...");

	const verKey = (tag) => tag.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
	const cmp = (a, b) => {
		const [A, B, C] = verKey(a);
		const [D, E, F] = verKey(b);
		return A - D || B - E || C - F;
	};

	// All patch tags vX.Y.Z, sorted ascending.
	const allTags = sh('git tag -l "v*.*.*"').split("\n").filter(Boolean).sort(cmp);

	if (allTags.length === 0) {
		setOutput("orphans-found", "false");
		setOutput("fixed-tags", "");
		setOutput("orphaned-tags-json", "[]");
		console.log("✅ No versioned tags found (v*.*.*).");
		process.exit(0);
	}

	const currentTag = allTags[allTags.length - 1];
	const [curMajNum, curMinNum] = verKey(currentTag);
	const curMaj = `v${curMajNum}`;
	const curMin = `v${curMajNum}.${curMinNum}`;
	console.log(`🏷️ Current tag: ${currentTag} (major: ${curMaj}, minor: ${curMin})`);

	const allRefTags = sh("git tag -l").split("\n").filter(Boolean);
	const existingMajors = allRefTags.filter((t) => /^v\d+$/.test(t)).sort((a, b) => verKey(a)[0] - verKey(b)[0]);
	const existingMinors = allRefTags
		.filter((t) => /^v\d+\.\d+$/.test(t))
		.sort((a, b) => {
			const [A, B] = verKey(a);
			const [D, E] = verKey(b);
			return A - D || B - E;
		});

	/** Resolve the commit a ref points at, or "" if missing. */
	const rev = (ref) => {
		try {
			return sh(`git rev-list -n 1 "${ref}"`);
		} catch {
			return "";
		}
	};

	/** Latest patch tag sharing a `vX.` / `vX.Y.` prefix. */
	const latestPatchForPrefix = (prefix) => {
		const picks = allTags.filter((t) => t.startsWith(prefix));
		return picks.length ? picks[picks.length - 1] : "";
	};

	const orphanRows = [];
	const fixedTagsLines = [];
	let orphansFound = false;

	// Check major tags (skipping the current major — handled by the regular update).
	for (const majorTag of existingMajors) {
		if (majorTag === curMaj) {
			console.log(`⏭️ Skipping ${majorTag} (current major version - handled by regular update)`);
			continue;
		}
		console.log(`🔍 Checking existing major tag: ${majorTag}`);
		const latest = latestPatchForPrefix(`v${verKey(majorTag)[0]}.`);
		if (!latest) continue;

		const majorCommit = rev(majorTag);
		const latestCommit = rev(latest);
		console.log(`  📍 ${majorTag} points to: ${majorCommit}`);
		console.log(`  📍 ${latest} points to: ${latestCommit}`);

		if (majorCommit && majorCommit !== latestCommit) {
			console.log(`🚨 Orphaned major tag detected: ${majorTag} should point to ${latest}`);
			orphanRows.push({ tag: majorTag, sha: latestCommit });
			fixedTagsLines.push(`${majorTag} → ${latest}`);
			orphansFound = true;
		} else {
			console.log(`✅ ${majorTag} correctly points to ${latest}`);
		}
	}

	// Check minor tags (skipping the current minor).
	for (const minorTag of existingMinors) {
		if (minorTag === curMin) {
			console.log(`⏭️ Skipping ${minorTag} (current minor version - handled by regular update)`);
			continue;
		}
		console.log(`🔍 Checking existing minor tag: ${minorTag}`);
		const [M, m] = verKey(minorTag);
		const latest = latestPatchForPrefix(`v${M}.${m}.`);
		if (!latest) continue;

		const minorCommit = rev(minorTag);
		const latestCommit = rev(latest);
		console.log(`  📍 ${minorTag} points to: ${minorCommit}`);
		console.log(`  📍 ${latest} points to: ${latestCommit}`);

		if (minorCommit && minorCommit !== latestCommit) {
			console.log(`🚨 Orphaned minor tag detected: ${minorTag} should point to ${latest}`);
			orphanRows.push({ tag: minorTag, sha: latestCommit });
			fixedTagsLines.push(`${minorTag} → ${latest}`);
			orphansFound = true;
		} else {
			console.log(`✅ ${minorTag} correctly points to ${latest}`);
		}
	}

	setOutput("fixed-tags", fixedTagsLines.join("\n"));
	setOutput("orphans-found", String(orphansFound));

	if (orphansFound) {
		const compact = JSON.stringify(orphanRows);
		setOutput("orphaned-tags-json", compact);
		console.log(`🔧 Orphaned tags JSON: ${compact}`);
	} else {
		setOutput("orphaned-tags-json", "[]");
		console.log("✅ No orphaned major/minor version tags found");
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
