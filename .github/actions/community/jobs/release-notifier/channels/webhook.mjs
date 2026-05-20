/**
 * @fileoverview Generic JSON webhook channel handler. Substitutes ${VAR}
 * placeholders in the user-supplied template with release/repo info.
 * @module @cldmv/.github.community.jobs.release-notifier.channels.webhook
 */

export async function dispatch(channel, release, repo) {
	const url = process.env[channel.webhook_secret];
	if (!url) throw new Error(`Webhook secret "${channel.webhook_secret}" not set in env`);

	const tpl = channel.template || `{"text": "🚀 \${REPO} \${TAG} released — \${URL}"}`;

	const vars = {
		REPO: repo,
		TAG: release.tag_name || "",
		NAME: release.name || release.tag_name || "",
		URL: release.html_url || "",
		BODY: (release.body || "").replace(/"/g, '\\"').replace(/\n/g, "\\n"),
		PRERELEASE: release.prerelease ? "true" : "false"
	};
	const body = tpl.replace(/\$\{(\w+)\}/g, (_, key) => (vars[key] != null ? vars[key] : ""));

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Webhook POST ${res.status}: ${text}`);
	}
}
