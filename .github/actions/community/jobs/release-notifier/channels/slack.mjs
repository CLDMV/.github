/**
 * @fileoverview Slack webhook channel handler (Block Kit).
 * @module @cldmv/.github.community.jobs.release-notifier.channels.slack
 */

import { truncate } from "../util.mjs";

export async function dispatch(channel, release, repo) {
	const url = process.env[channel.webhook_secret];
	if (!url) throw new Error(`Slack secret "${channel.webhook_secret}" not set in env`);

	const includeChangelog = channel.include_changelog !== false;
	const lines = Number(channel.changelog_lines || 15);

	const blocks = [
		{
			type: "header",
			text: { type: "plain_text", text: `🚀 ${repo} ${release.tag_name} released` }
		}
	];

	if (includeChangelog && release.body) {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: truncate(release.body, lines) }
		});
	}

	blocks.push({
		type: "actions",
		elements: [
			{
				type: "button",
				text: { type: "plain_text", text: "View Release" },
				url: release.html_url
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
