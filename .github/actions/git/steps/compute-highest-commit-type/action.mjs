/**
 * @fileoverview Compute the highest-priority Conventional-Commit type across
 * a set of commits, and the implied semver bump. Pure logic — exports the
 * core functions for tests; the IIFE at the bottom drives the action.
 *
 * @module @cldmv/.github.git.steps.compute-highest-commit-type
 */

import { readFileSync } from "node:fs";
import { getInput, setOutputs } from "../../../common/common/core.mjs";

/**
 * Conventional types in priority order (highest = most important). Used to
 * pick the dominant type when a range contains multiple. Breaking commits
 * outrank all of these regardless of their own type.
 *
 * @public
 */
export const TYPE_PRIORITY = [
	"feat",
	"fix",
	"perf",
	"revert",
	"refactor",
	"style",
	"docs",
	"test",
	"build",
	"ci",
	"chore"
];

/**
 * Map a (type, isBreaking) pair to an implied semver bump.
 *
 * @public
 * @param {string} type - Conventional type (e.g. "feat", "fix"). Empty string
 *   when nothing parsed.
 * @param {boolean} isBreaking - Whether any commit declared a breaking change.
 * @returns {"major"|"minor"|"patch"|"none"}
 */
export function bumpFor(type, isBreaking) {
	if (isBreaking) return "major";
	if (type === "feat") return "minor";
	if (type === "fix" || type === "perf" || type === "revert") return "patch";
	return "none";
}

const CONVENTIONAL_SUBJECT_RE = /^([a-z]+)(?:\([^)]*\))?(!)?:\s*.+$/;
const BREAKING_FOOTER_RE = /^BREAKING[\s-]CHANGE:/m;

/**
 * Parse a single commit subject + optional body into { type, isBreaking }.
 * Returns null when the subject doesn't match Conventional Commits format.
 *
 * @public
 * @param {string} subject - First line of the commit message.
 * @param {string} [body=""] - Remainder of the commit message (may be empty).
 * @returns {{ type: string, isBreaking: boolean } | null}
 */
export function parseCommit(subject, body = "") {
	if (typeof subject !== "string") return null;
	const m = subject.match(CONVENTIONAL_SUBJECT_RE);
	if (!m) return null;
	const type = m[1].toLowerCase();
	const breakingMark = !!m[2];
	const breakingFooter = typeof body === "string" && BREAKING_FOOTER_RE.test(body);
	return { type, isBreaking: breakingMark || breakingFooter };
}

/**
 * Reduce a list of parsed commits to the highest-priority result.
 *
 * @public
 * @param {Array<{ subject: string, body?: string }>} commits
 * @returns {{ highestType: string, isBreaking: boolean, bump: "major"|"minor"|"patch"|"none" }}
 */
export function computeHighest(commits) {
	let highestType = "";
	let highestRank = Infinity;
	let isBreaking = false;

	for (const c of commits || []) {
		const parsed = parseCommit(c?.subject ?? "", c?.body ?? "");
		if (!parsed) continue;
		if (parsed.isBreaking) isBreaking = true;
		const rank = TYPE_PRIORITY.indexOf(parsed.type);
		// Unknown types rank after the known list but still get considered.
		const effectiveRank = rank === -1 ? TYPE_PRIORITY.length : rank;
		if (effectiveRank < highestRank) {
			highestRank = effectiveRank;
			highestType = parsed.type;
		}
	}

	return {
		highestType,
		isBreaking,
		bump: bumpFor(highestType, isBreaking)
	};
}

function loadCommits() {
	const file = getInput("commits-file");
	const inline = getInput("commits-json");
	if (file && inline) {
		throw new Error("commits-file and commits-json are mutually exclusive — pass one, not both");
	}
	if (!file && !inline) {
		throw new Error("either commits-file or commits-json must be provided");
	}
	const raw = file ? readFileSync(file, "utf8") : inline;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		throw new Error(`Failed to parse commits JSON: ${e.message}`);
	}
	if (!Array.isArray(parsed)) {
		throw new Error("commits JSON must be an array");
	}
	return parsed;
}

// Action entry — only runs when this module is the program entry, not when
// imported by test.mjs.
if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		const commits = loadCommits();
		const { highestType, isBreaking, bump } = computeHighest(commits);
		setOutputs({
			"highest-type": highestType,
			"is-breaking": String(isBreaking),
			bump
		});
		console.log(`📊 Highest type: ${highestType || "(none)"} | breaking: ${isBreaking} | bump: ${bump}`);
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}
