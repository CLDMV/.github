/**
 * @fileoverview Discord webhook channel handler.
 * @module @cldmv/.github.community.jobs.release-notifier.channels.discord
 */

import { truncate } from "../util.mjs";

export async function dispatch(channel, release, repo) {
	const url = process.env[channel.webhook_secret];
	if (!url) throw new Error(`Discord secret "${channel.webhook_secret}" not set in env`);

	const color = typeof channel.color === "number" ? channel.color : parseInt(String(channel.color || "0x22c55e").replace("0x", ""), 16);
	const includeChangelog = channel.include_changelog !== false;
	const lines = Number(channel.changelog_lines || 10);

	const description = includeChangelog && release.body
		? truncate(release.body, lines) + `\n\n[See full release →](${release.html_url})`
		: `[See release →](${release.html_url})`;

	const payload = {
		embeds: [
			{
				title: `🚀 ${repo} ${release.tag_name} released`,
				url: release.html_url,
				description,
				color,
				footer: { text: repo },
				timestamp: release.published_at || new Date().toISOString()
			}
		]
	};

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Discord POST ${res.status}: ${text}`);
	}
}
