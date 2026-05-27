/**
 * @fileoverview Generic JSON webhook channel handler. POSTs a flat JSON
 * payload to the supplied URL with all event fields as top-level keys —
 * receivers (Matrix, Mattermost, n8n, custom bots) read whatever they need.
 * Shape is event_kind-tagged so consumers can dispatch on it.
 * @module @cldmv/.github.community.jobs.release-notifier.channels.generic
 */

/**
 * @param {string} url - Generic webhook URL.
 * @param {"releases"|"pr"|"release_pr"} kind - Event kind.
 * @param {object} e - Normalized event data from action.mjs.
 */
export async function dispatch(url, kind, e) {
	// Flat shape: receivers either consume the structured fields or render
	// the pre-built `text` summary line. Both are always present.
	let text;
	if (kind === "releases") {
		text = `🚀 ${e.repo} ${e.tag_name} released — ${e.html_url}`;
	} else if (kind === "pr") {
		const draftMark = e.draft ? " (draft)" : "";
		text = `📥 PR #${e.number} opened${draftMark}: ${e.title} — ${e.html_url}`;
	} else if (kind === "release_pr") {
		text = `🏷️ Release PR #${e.number} → v${e.version} — ${e.html_url}`;
	} else {
		throw new Error(`Unknown event_kind: "${kind}"`);
	}

	const payload = { kind, text, ...e };

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Webhook POST ${res.status}: ${body}`);
	}
}
