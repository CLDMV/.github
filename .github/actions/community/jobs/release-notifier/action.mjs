/**
 * @fileoverview Release notifier entry point. Loads org-default + per-repo
 * channel configs, merges by id, dispatches per channel with continue-on-
 * failure semantics. Batch 6.2.
 * @module @cldmv/.github.community.jobs.release-notifier
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../../github/api/_api/core.mjs";
import { dispatch as discordDispatch } from "./channels/discord.mjs";
import { dispatch as slackDispatch } from "./channels/slack.mjs";
import { dispatch as webhookDispatch } from "./channels/webhook.mjs";

const DISPATCHERS = {
	discord: discordDispatch,
	slack: slackDispatch,
	webhook: webhookDispatch
};

/** Minimal YAML parser for our channels config shape. */
function parseChannelsYaml(text) {
	const channels = [];
	let current = null;
	let inChannels = false;
	const lines = text.split(/\r?\n/);
	for (const rawLine of lines) {
		const line = rawLine.replace(/(^|[^"'])#.*$/, "$1").trimEnd();
		if (!line.trim()) continue;
		if (/^channels\s*:\s*$/.test(line)) {
			inChannels = true;
			continue;
		}
		if (!inChannels) continue;
		// New channel: `  - id: foo`
		const newChan = line.match(/^\s+-\s+(\w+)\s*:\s*(.*)$/);
		if (newChan) {
			if (current) channels.push(current);
			current = {};
			current[newChan[1]] = parseScalar(newChan[2]);
			continue;
		}
		// Continued field: `    key: value`
		const kv = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
		if (kv && current) {
			current[kv[1]] = parseScalar(kv[2]);
		}
	}
	if (current) channels.push(current);
	return channels;
}

function parseScalar(raw) {
	const s = raw.trim();
	if (s === "") return "";
	if (s === "true") return true;
	if (s === "false") return false;
	if (/^-?\d+$/.test(s)) return Number(s);
	if (/^-?\d+\.\d+$/.test(s)) return Number(s);
	if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
	if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
		return s.slice(1, -1);
	}
	return s;
}

/** Fetch raw file content from a repo. Returns null on 404. */
async function readFile({ token, owner, repo, path, ref }) {
	const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : "";
	try {
		const res = await api("GET", `/contents/${path}${refQuery}`, null, { token, owner, repo });
		if (res?.content && res.encoding === "base64") {
			return Buffer.from(res.content, "base64").toString("utf8");
		}
	} catch (err) {
		if (!err.message.includes("404")) throw err;
	}
	return null;
}

/** Merge two channel arrays by id; per-repo overrides org default settings. */
function mergeChannels(orgDefaults, perRepo) {
	const byId = new Map();
	for (const c of orgDefaults) if (c.id) byId.set(c.id, { ...c });
	for (const c of perRepo) {
		if (!c.id) continue;
		const existing = byId.get(c.id);
		if (existing) byId.set(c.id, { ...existing, ...c });
		else byId.set(c.id, { ...c });
	}
	return [...byId.values()];
}

try {
	const token = getInput("github_token", { required: true });
	const configPath = getInput("config_path") || ".github/release-notifier.yml";
	const defaultRepo = getInput("default_config_repo") || "CLDMV/.github";
	const defaultRef = getInput("default_config_ref") || "v2";
	const defaultPath = getInput("default_config_path") || ".github/templates/release-notifier.default.yml";

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: "${repository}"`);

	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) throw new Error("GITHUB_EVENT_PATH not set");
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
	const release = event.release;
	if (!release) {
		console.log("ℹ️ No release in event; skipping.");
		process.exit(0);
	}
	if (release.draft) {
		console.log("ℹ️ Draft release; skipping.");
		process.exit(0);
	}
	if (!release.tag_name) {
		console.log("ℹ️ Untagged release; skipping (defensive guard).");
		process.exit(0);
	}

	// Load configs
	const [defOwner, defRepo] = defaultRepo.split("/");
	const orgConfigText = await readFile({ token, owner: defOwner, repo: defRepo, path: defaultPath, ref: defaultRef });
	const orgChannels = orgConfigText ? parseChannelsYaml(orgConfigText) : [];
	const repoConfigText = await readFile({ token, owner, repo, path: configPath, ref: null });
	const repoChannels = repoConfigText ? parseChannelsYaml(repoConfigText) : [];

	const merged = mergeChannels(orgChannels, repoChannels);
	const enabled = merged.filter((c) => c.enabled !== false && c.type);
	console.log(`📣 ${enabled.length} channel(s) enabled (${merged.length} merged, ${orgChannels.length} org + ${repoChannels.length} per-repo)`);

	const results = { ok: 0, failed: [] };
	for (const channel of enabled) {
		const dispatcher = DISPATCHERS[channel.type];
		if (!dispatcher) {
			console.log(`::warning::Unknown channel type "${channel.type}" for id "${channel.id}"; skipping.`);
			continue;
		}
		try {
			console.log(`  → ${channel.id} (${channel.type})`);
			await dispatcher(channel, release, repository);
			results.ok++;
		} catch (err) {
			console.log(`  ✗ ${channel.id}: ${err.message}`);
			results.failed.push({ id: channel.id, error: err.message });
		}
	}

	appendSummary(`## 📣 Release Notifier`);
	appendSummary(``);
	appendSummary(`- ✅ Delivered: **${results.ok}**`);
	if (results.failed.length) {
		appendSummary(`- ✗ Failed: **${results.failed.length}**`);
		for (const f of results.failed) appendSummary(`  - \`${f.id}\`: ${f.error}`);
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
