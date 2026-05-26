/**
 * @fileoverview Slack webhook channel handler (Block Kit). Posts a header +
 * context block + action button shaped by event_kind to the supplied URL.
 * @module @cldmv/.github.community.jobs.release-notifier.channels.slack
 */

import { truncate } from "../util.mjs";

/**
 * @param {string} url - Slack webhook URL.
 * @param {"releases"|"pr"|"release_pr"} kind - Event kind.
 * @param {object} e - Normalized event data from action.mjs.
 */
export async function dispatch(url, kind, e) {
	const blocks = [];
	let buttonText;

	if (kind === "releases") {
		blocks.push({ type: "header", text: { type: "plain_text", text: `🚀 ${e.repo} ${e.tag_name} released` } });
		if (e.body) {
			blocks.push({ type: "section", text: { type: "mrkdwn", text: truncate(e.body, 15) } });
		}
		buttonText = "View Release";
	} else if (kind === "pr") {
		const draftMark = e.draft ? "📝 (draft) " : "";
		blocks.push({ type: "header", text: { type: "plain_text", text: `${draftMark}📥 PR #${e.number} opened` } });
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*${e.title}*\n\`${e.head}\` → \`${e.base}\`${e.author ? ` by @${e.author}` : ""}\n_${e.repo}_` }
		});
		buttonText = "View PR";
	} else if (kind === "release_pr") {
		blocks.push({ type: "header", text: { type: "plain_text", text: `🏷️ Release PR #${e.number} → v${e.version}` } });
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: `*${e.title}*\n\`${e.head}\` → \`${e.base || "master"}\`\n_${e.repo}_` }
		});
		buttonText = "View Release PR";
	} else {
		throw new Error(`Unknown event_kind: "${kind}"`);
	}

	blocks.push({
		type: "actions",
		elements: [
			{
				type: "button",
				text: { type: "plain_text", text: buttonText },
				url: e.html_url
			}
		]
	});

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ blocks })
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Slack POST ${res.status}: ${text}`);
	}
}
