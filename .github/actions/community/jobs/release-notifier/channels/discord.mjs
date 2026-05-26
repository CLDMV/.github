/**
 * @fileoverview Discord webhook channel handler. POSTs an embed shaped by
 * event_kind to the supplied webhook URL.
 * @module @cldmv/.github.community.jobs.release-notifier.channels.discord
 */

import { truncate } from "../util.mjs";

const COLORS = {
	releases: 0x22c55e, // green
	pr: 0x3b82f6, // blue
	release_pr: 0xa855f7 // purple
};

/**
 * @param {string} url - Discord webhook URL.
 * @param {"releases"|"pr"|"release_pr"} kind - Event kind.
 * @param {object} e - Normalized event data from action.mjs.
 */
export async function dispatch(url, kind, e) {
	let embed;

	if (kind === "releases") {
		const description = e.body ? truncate(e.body, 10) + `\n\n[See full release →](${e.html_url})` : `[See release →](${e.html_url})`;
		embed = {
			title: `🚀 ${e.repo} ${e.tag_name} released`,
			url: e.html_url,
			description,
			color: COLORS.releases,
			footer: { text: e.repo },
			timestamp: e.published_at
		};
	} else if (kind === "pr") {
		const draftMark = e.draft ? "📝 (draft) " : "";
		embed = {
			title: `${draftMark}📥 PR #${e.number} opened: ${e.title}`,
			url: e.html_url,
			description: `\`${e.head}\` → \`${e.base}\`${e.author ? ` by @${e.author}` : ""}`,
			color: COLORS.pr,
			footer: { text: e.repo }
		};
	} else if (kind === "release_pr") {
		embed = {
			title: `🏷️ Release PR #${e.number} → v${e.version}`,
			url: e.html_url,
			description: `\`${e.head}\` → \`${e.base || "master"}\``,
			color: COLORS.release_pr,
			footer: { text: e.repo }
		};
	} else {
		throw new Error(`Unknown event_kind: "${kind}"`);
	}

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ embeds: [embed] })
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Discord POST ${res.status}: ${text}`);
	}
}
