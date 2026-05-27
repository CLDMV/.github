/**
 * @fileoverview Release / PR / release-PR notifier. Looks up one secret per
 * (type, kind, visibility) tuple — if the secret is set, dispatches; if not,
 * skips. No config file: the secret name itself encodes the channel.
 *
 *   Secret naming: <TYPE>_<KIND>_<VIS>_WEBHOOK
 *     TYPE   = DISCORD | SLACK | GENERIC
 *     KIND   = RELEASES | PR | RELEASE_PR
 *     VIS    = PUBLIC | PRIVATE
 *
 *   Visibility is derived from the repo: GitHub `public` → PUBLIC; `private`
 *   or `internal` → PRIVATE. Internal repos are non-public; they route to
 *   the private webhook.
 *
 *   Per-repo override: set a repo secret with the same name to override the
 *   org-level URL, or to an empty string to mute that channel for the repo.
 *   GitHub's secret precedence (repo > org) handles the override for free.
 *
 * @module @cldmv/.github.community.jobs.release-notifier
 */

import { getInput, appendSummary, getEventPayload } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";
import { dispatch as discordDispatch } from "./channels/discord.mjs";
import { dispatch as slackDispatch } from "./channels/slack.mjs";
import { dispatch as genericDispatch } from "./channels/generic.mjs";

const DISPATCHERS = {
	discord: discordDispatch,
	slack: slackDispatch,
	generic: genericDispatch
};

const TYPES = ["discord", "slack", "generic"];
const KIND_KEYS = { releases: "RELEASES", pr: "PR", release_pr: "RELEASE_PR" };

/**
 * Determine repo visibility — `private` or `public`. GitHub `internal` repos
 * route to `private` because they are not publicly visible (the whole point
 * of the split is "don't broadcast non-public repo activity to public
 * webhooks"). Reads from the event payload's `repository` object when
 * available; falls back to a `/repos/{owner}/{repo}` GET otherwise.
 */
async function detectVisibility(event, owner, repo, token) {
	const repository = event?.repository;
	if (repository) {
		if (repository.visibility === "private" || repository.visibility === "internal") return "private";
		if (repository.visibility === "public") return "public";
		if (typeof repository.private === "boolean") return repository.private ? "private" : "public";
	}
	const fetched = await api("GET", "", null, { token, owner, repo });
	if (fetched?.visibility === "private" || fetched?.visibility === "internal") return "private";
	return fetched?.private ? "private" : "public";
}

/** Normalize the trigger event into per-kind eventData consumed by handlers. */
async function buildEventData(kind, event, owner, repo, token) {
	const repoName = `${owner}/${repo}`;
	if (kind === "releases") {
		const r = event?.release;
		if (!r) throw new Error("event_kind=releases but no `release` in event payload");
		return {
			repo: repoName,
			tag_name: r.tag_name || "",
			name: r.name || r.tag_name || "",
			body: r.body || "",
			html_url: r.html_url || "",
			prerelease: !!r.prerelease,
			published_at: r.published_at || new Date().toISOString()
		};
	}
	if (kind === "pr") {
		const p = event?.pull_request;
		if (!p) throw new Error("event_kind=pr but no `pull_request` in event payload");
		return {
			repo: repoName,
			number: p.number,
			title: p.title || "",
			html_url: p.html_url || "",
			author: p.user?.login || "",
			base: p.base?.ref || "",
			head: p.head?.ref || "",
			draft: !!p.draft
		};
	}
	if (kind === "release_pr") {
		// Inline-called from update-release-pr; trigger event is `push`, not
		// `pull_request`, so we fetch the PR via API.
		const prNumber = Number(getInput("pr_number", { required: true }));
		const version = getInput("version", { required: true });
		const pr = await api("GET", `/pulls/${prNumber}`, null, { token, owner, repo });
		return {
			repo: repoName,
			number: pr.number,
			title: pr.title || "",
			html_url: pr.html_url || "",
			base: pr.base?.ref || "master",
			head: pr.head?.ref || "",
			version
		};
	}
	throw new Error(`Unknown event_kind: "${kind}"`);
}

try {
	const token = getInput("github_token", { required: true });
	const kind = getInput("event_kind", { required: true });
	if (!Object.prototype.hasOwnProperty.call(KIND_KEYS, kind)) {
		throw new Error(`Invalid event_kind: "${kind}" (expected one of: ${Object.keys(KIND_KEYS).join(", ")})`);
	}

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: "${repository}"`);

	const event = getEventPayload();

	// Pre-flight gates: skip the noisy / non-actionable cases entirely.
	if (kind === "releases") {
		if (!event?.release) {
			console.log("ℹ️ No release in event; skipping.");
			process.exit(0);
		}
		if (event.release.draft) {
			console.log("ℹ️ Draft release; skipping.");
			process.exit(0);
		}
		if (!event.release.tag_name) {
			console.log("ℹ️ Untagged release; skipping (defensive guard).");
			process.exit(0);
		}
	}

	const visibility = await detectVisibility(event, owner, repo, token);
	const visKey = visibility === "private" ? "PRIVATE" : "PUBLIC";
	const kindKey = KIND_KEYS[kind];

	const eventData = await buildEventData(kind, event, owner, repo, token);

	console.log(`📣 event_kind=${kind} visibility=${visibility} repo=${owner}/${repo}`);

	const results = { ok: 0, failed: [], skipped: 0 };
	for (const type of TYPES) {
		const secretName = `${type.toUpperCase()}_${kindKey}_${visKey}_WEBHOOK`;
		const url = process.env[secretName];
		if (!url) {
			console.log(`  · ${type}: ${secretName} unset — skipped`);
			results.skipped++;
			continue;
		}
		try {
			console.log(`  → ${type}: ${secretName}`);
			await DISPATCHERS[type](url, kind, eventData);
			results.ok++;
		} catch (err) {
			console.log(`  ✗ ${type}: ${err.message}`);
			results.failed.push({ type, error: err.message });
		}
	}

	appendSummary(`## 📣 Release Notifier`);
	appendSummary(``);
	appendSummary(`- event_kind: \`${kind}\``);
	appendSummary(`- visibility: \`${visibility}\``);
	appendSummary(`- ✅ Delivered: **${results.ok}**`);
	appendSummary(`- · Skipped (no secret): **${results.skipped}**`);
	if (results.failed.length) {
		appendSummary(`- ✗ Failed: **${results.failed.length}**`);
		for (const f of results.failed) appendSummary(`  - \`${f.type}\`: ${f.error}`);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
