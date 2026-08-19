#!/usr/bin/env node

import { execSync } from "child_process";

const sh = (cmd) => {
	try {
		return execSync(cmd, { encoding: "utf8", cwd: "p:\\Dropbox\\Sync\\Documents\\CLDMV\\repos\\.github" }).trim();
	} catch (error) {
		console.error(`Error running: ${cmd}`, error.message);
		return "";
	}
};

// parse version
const verKey = (t) =>
	t
		.replace(/^v/, "")
		.split(".")
		.map((n) => parseInt(n, 10));

const cmp = (a, b) => {
	const [A, B, C] = verKey(a);
	const [D, E, F] = verKey(b);
	return A - D || B - E || C - F;
};

// refresh tags
try {
	sh("git fetch --prune --tags --force");
} catch {
	// Best-effort refresh — a stale/unreachable remote shouldn't block the
	// tag comparison below, which still works against whatever tags are
	// already present locally.
}

const allTags = sh('git tag -l "v*.*.*"').split("\n").filter(Boolean).sort(cmp);
const allRefTags = sh("git tag -l").split("\n").filter(Boolean);
const majors = allRefTags.filter((t) => /^v\d+$/.test(t));
const minors = allRefTags.filter((t) => /^v\d+\.\d+$/.test(t));

console.log("📋 Semantic version tags:", allTags.join(", "));
console.log("📋 Existing major tags:", majors.join(", "));
console.log("📋 Existing minor tags:", minors.join(", "));

const latestPatchForMajor = (M) => {
	const prefix = `v${M}.`;
	const picks = allTags.filter((t) => t.startsWith(prefix));
	return picks.length ? picks[picks.length - 1] : "";
};
const latestPatchForMinor = (M_m) => {
	const prefix = `v${M_m}.`;
	const picks = allTags.filter((t) => t.startsWith(prefix));
	return picks.length ? picks[picks.length - 1] : "";
};

// Find all unique major.minor combinations from semantic version tags
const allMajorMinors = new Set();
for (const tag of allTags) {
	const [M, m] = verKey(tag);
	if (!isNaN(M) && !isNaN(m)) {
		allMajorMinors.add(`${M}.${m}`);
	}
}

console.log("\n🔍 Checking for missing minor tags...");
for (const majorMinor of allMajorMinors) {
	const [M, m] = majorMinor.split(".").map((n) => parseInt(n, 10));
	const expectedMinorTag = `v${M}.${m}`;

	if (minors.includes(expectedMinorTag)) {
		console.log(`✅ Minor tag ${expectedMinorTag} exists`);
	} else {
		const latest = latestPatchForMinor(majorMinor);
		console.log(`🚨 Missing minor tag: ${expectedMinorTag} → ${latest}`);
	}
}

console.log("\n🔍 Checking for missing major tags...");
const allMajors = new Set();
for (const tag of allTags) {
	const [M] = verKey(tag);
	if (!isNaN(M)) {
		allMajors.add(M);
	}
}

for (const M of allMajors) {
	const expectedMajorTag = `v${M}`;

	if (majors.includes(expectedMajorTag)) {
		console.log(`✅ Major tag ${expectedMajorTag} exists`);
	} else {
		const latest = latestPatchForMajor(M);
		console.log(`🚨 Missing major tag: ${expectedMajorTag} → ${latest}`);
	}
}
