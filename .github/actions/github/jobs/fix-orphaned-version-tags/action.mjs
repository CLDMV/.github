import { execSync } from "node:child_process";
import fs from "node:fs";

const out = process.env.GITHUB_OUTPUT;

// run shell command and capture stdout
const sh = (cmd) =>
	execSync(cmd, { stdio: ["ignore", "pipe", "inherit"] })
		.toString()
		.trim();

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
} catch {}

const allTags = sh('git tag -l "v*.*.*"').split("\n").filter(Boolean).sort(cmp);

if (allTags.length === 0) {
	fs.appendFileSync(out, "orphans-found=false\n");
	fs.appendFileSync(out, "fixed-tags=\n");
	fs.appendFileSync(out, "orphaned-tags-json=[]\n");
	console.log("✅ No versioned tags found (v*.*.*).");
	process.exit(0);
}

const currentTag = allTags[allTags.length - 1];
const [curMajNum, curMinNum] = verKey(currentTag);
const curMaj = `v${curMajNum}`;
const curMin = `v${curMajNum}.${curMinNum}`;

const allRefTags = sh("git tag -l").split("\n").filter(Boolean);
const majors = allRefTags.filter((t) => /^v\d+$/.test(t));
const minors = allRefTags.filter((t) => /^v\d+\.\d+$/.test(t));

const rev = (ref) => {
	try {
		return sh(`git rev-list -n 1 "${ref}"`);
	} catch {
		return "";
	}
};
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

const orphanRows = [];
const fixedLines = [];
let found = false;

// check majors
for (const mt of majors) {
	if (mt === curMaj) continue;
	const M = verKey(mt)[0];
	const latest = latestPatchForMajor(M);
	if (!latest) continue;
	const wantSha = rev(latest),
		haveSha = rev(mt);
	if (wantSha && haveSha && wantSha !== haveSha) {
		found = true;
		orphanRows.push({ tag: mt, sha: wantSha });
		fixedLines.push(`${mt} → ${latest}`);
		console.log(`🚨 Orphaned major tag: ${mt} → ${latest}`);
	} else {
		console.log(`✅ Major tag ${mt} is correct`);
	}
}

// check minors
for (const nt of minors) {
	if (nt === curMin) continue;
	const [M, m] = verKey(nt);
	const latest = latestPatchForMinor(`${M}.${m}`);
	if (!latest) continue;
	const wantSha = rev(latest),
		haveSha = rev(nt);
	if (wantSha && haveSha && wantSha !== haveSha) {
		found = true;
		orphanRows.push({ tag: nt, sha: wantSha });
		fixedLines.push(`${nt} → ${latest}`);
		console.log(`🚨 Orphaned minor tag: ${nt} → ${latest}`);
	} else {
		console.log(`✅ Minor tag ${nt} is correct`);
	}
}

// outputs
const fixedText = fixedLines.join("\n");
fs.appendFileSync(out, `fixed-tags<<EOF\n${fixedText}\nEOF\n`);
fs.appendFileSync(out, `orphans-found=${found}\n`);
fs.appendFileSync(out, `orphaned-tags-json=${JSON.stringify(orphanRows)}\n`);

if (!found) {
	console.log("✅ No orphaned major/minor tags detected.");
}
