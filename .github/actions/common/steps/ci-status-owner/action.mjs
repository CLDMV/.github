/**
 * @fileoverview Decide whether this CI run owns the `✅ Required PR Check`
 * status for its head SHA (CLDMV/.github#531).
 *
 * The ci.yml caller runs on `push` and on `pull_request`. For an in-repo PR
 * the push run on the head branch tests the head SHA and posts the required
 * check, so the pull_request run must not run CI again. Two pull_request
 * cases still need their own run:
 *   - a fork PR: no push run fires upstream for fork commits;
 *   - a release PR (head `next` / `hotfixes`) whose head commit is the bot's
 *     `chore: bump version`: workflow-ci.yml's commit-gate skips the matrix
 *     on that push, so nothing has tested the SHA.
 * A release PR whose head is any other commit (a feature merge, the base→next
 * sync merge, a lint-format autofix) was tested by its push run, and running
 * the matrix again only doubles the release's wait.
 *
 * The pull_request event payload doesn't carry the head commit's message, so
 * it's read from the API. A lookup failure fails safe: the run owns the
 * status and tests the SHA, a duplicate run at worst.
 *
 * @module @cldmv/.github.common.steps.ci-status-owner
 */

import { getInput, getEventPayload, setOutputs } from "../../../common/common/core.mjs";
import { api, parseRepo } from "../../../github/api/_api/core.mjs";

const RELEASE_HEADS = ["next", "hotfixes"];

/**
 * Whether a commit message starts with any of the prefixes.
 *
 * @param {string} message
 * @param {string[]} prefixes
 * @returns {boolean}
 */
export function isBumpCommit(message, prefixes) {
	const msg = String(message || "");
	return prefixes.some((p) => p && msg.startsWith(p));
}

/**
 * Split the comma-separated prefixes input.
 *
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePrefixes(raw) {
	return String(raw || "")
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
}

/**
 * Decide ownership for an event, reading the head commit only when needed.
 *
 * @param {object} args
 * @param {string} args.eventName - GITHUB_EVENT_NAME.
 * @param {object} args.event - Event payload.
 * @param {string[]} args.prefixes - Bump-commit prefixes.
 * @param {(sha: string) => Promise<string>} args.readMessage - Returns the commit message for a SHA.
 * @returns {Promise<{owns: boolean, reason: string, warn?: boolean}>}
 */
export async function decide({ eventName, event, prefixes, readMessage }) {
	if (eventName !== "pull_request" && eventName !== "pull_request_target") {
		return { owns: true, reason: `event=${eventName || "<unknown>"}: this run tests its own SHA` };
	}
	const pr = event?.pull_request || {};
	if (pr.head?.repo?.fork === true) {
		return { owns: true, reason: "fork PR: no push run fires upstream for fork commits" };
	}
	const headRef = pr.head?.ref || "";
	if (!RELEASE_HEADS.includes(headRef)) {
		return { owns: false, reason: `in-repo PR from ${headRef || "<unknown>"}: the push run on that branch reports the check` };
	}
	const sha = pr.head?.sha || "";
	if (!sha) {
		return { owns: true, warn: true, reason: `release PR from ${headRef} with no head SHA in the payload; running CI to be safe` };
	}
	let message;
	try {
		message = await readMessage(sha);
	} catch (error) {
		return {
			owns: true,
			warn: true,
			reason: `release PR from ${headRef}: reading ${sha.slice(0, 7)} failed (${error.message}); running CI to be safe`
		};
	}
	const subject = String(message || "").split("\n")[0];
	if (isBumpCommit(message, prefixes)) {
		return { owns: true, reason: `release PR head ${sha.slice(0, 7)} is "${subject}", which the push run skips` };
	}
	return { owns: false, reason: `release PR head ${sha.slice(0, 7)} ("${subject}") was tested by its push run, which reports the check` };
}

async function main() {
	const token = getInput("github-token", { required: true });
	const prefixes = parsePrefixes(getInput("bump_prefixes", { default: "chore: bump version" }));
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	const { owns, reason, warn } = await decide({
		eventName: process.env.GITHUB_EVENT_NAME || "",
		event: getEventPayload(),
		prefixes,
		readMessage: async (sha) => (await api("GET", `/commits/${sha}`, null, { token, owner, repo }))?.commit?.message || ""
	});

	if (warn) console.log(`::warning title=CI Status Owner::${reason.replace(/%/g, "%25").replace(/\r?\n/g, " ")}`);
	console.log(`${owns ? "✅" : "⏭️"} owns=${owns}: ${reason}`);
	setOutputs({ owns: owns ? "true" : "false", reason });
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exitCode = 1;
	}
}
