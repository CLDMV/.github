/**
 * @fileoverview Path-based PR label computation. Fetches PR file list,
 * loads a labeler config (per-repo with org-default fallback), glob-matches
 * paths against patterns, emits comma-sep aliases for resolve-labels.
 * Batch 5.2 from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.github.steps.compute-path-labels
 */

import { getInput, setOutput } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";

/** Minimal YAML parser for our labeler config shape: top-level keys → list of strings.
 *  Handles quoted keys (`"area:core":`) and unquoted simple keys (`docs:`). */
function parseSimpleYaml(text) {
	const result = {};
	let currentKey = null;
	const lines = text.split(/\r?\n/);
	for (const rawLine of lines) {
		// Strip line comments outside of quoted strings (lazy: just strip everything from first '#').
		const line = rawLine.replace(/#.*$/, "").trimEnd();
		if (!line.trim()) continue;

		// Quoted top-level key: `"area:core":` or `'area:core':`
		const quotedTop = line.match(/^["']([^"']+)["']\s*:\s*$/);
		if (quotedTop) {
			currentKey = quotedTop[1];
			result[currentKey] = [];
			continue;
		}

		// Unquoted top-level key: word chars only (no spaces, no colons in name)
		const unquotedTop = line.match(/^([A-Za-z0-9_-]+)\s*:\s*$/);
		if (unquotedTop) {
			currentKey = unquotedTop[1];
			result[currentKey] = [];
			continue;
		}

		// List item: `  - "pattern"` or `  - pattern`
		const itemMatch = line.match(/^\s+-\s+(.+)$/);
		if (itemMatch && currentKey) {
			let value = itemMatch[1].trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			result[currentKey].push(value);
		}
	}
	return result;
}

/** Convert a glob pattern to a RegExp. Supports `**`, `*`, `?`, character classes. */
function globToRegex(glob) {
	let re = "^";
	let i = 0;
	while (i < glob.length) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				// `**` matches anything including path separators
				re += ".*";
				i += 2;
				if (glob[i] === "/") i++; // consume trailing slash so **/foo matches foo too
				continue;
			}
			re += "[^/]*";
		} else if (c === "?") {
			re += "[^/]";
		} else if (c === ".") {
			re += "\\.";
		} else if ("()+|^$\\".includes(c)) {
			re += "\\" + c;
		} else if (c === "[" || c === "]") {
			re += c;
		} else {
			re += c;
		}
		i++;
	}
	re += "$";
	return new RegExp(re);
}

/** Match a file path against a glob; returns true on match. */
function globMatch(filePath, glob) {
	return globToRegex(glob).test(filePath);
}

/** Try to fetch a file's content from a repo. Returns null on 404. */
async function fetchFileContent({ token, owner, repo, path, ref }) {
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

try {
	const token = getInput("github-token", { required: true });
	const prNumber = getInput("pr-number", { required: true });
	const configPath = getInput("config-path") || ".github/labeler.yml";
	const defaultRepo = getInput("default-config-repo") || "CLDMV/.github";
	const defaultRef = getInput("default-config-ref") || "v2";
	const defaultPath = getInput("default-config-path") || ".github/labeler.default.yml";

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");
	if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: "${repository}"`);

	// 1. Get PR files (paginated; PRs may touch many files).
	let allFiles = [];
	let page = 1;
	while (page <= 10) {
		const batch = await api("GET", `/pulls/${prNumber}/files?per_page=100&page=${page}`, null, { token, owner, repo });
		if (!Array.isArray(batch) || batch.length === 0) break;
		allFiles = allFiles.concat(batch.map((f) => f.filename));
		if (batch.length < 100) break;
		page++;
	}
	console.log(`📂 PR #${prNumber} touches ${allFiles.length} files`);

	// 2. Load labeler config — per-repo first, then org-default.
	let configText = await fetchFileContent({ token, owner, repo, path: configPath, ref: null });
	if (!configText) {
		const [defOwner, defRepo] = defaultRepo.split("/");
		console.log(`📋 No ${configPath} in ${owner}/${repo}; falling back to ${defaultRepo}@${defaultRef}:${defaultPath}`);
		configText = await fetchFileContent({ token, owner: defOwner, repo: defRepo, path: defaultPath, ref: defaultRef });
	} else {
		console.log(`📋 Using per-repo labeler config: ${configPath}`);
	}
	if (!configText) {
		console.log("ℹ️ No labeler config found; emitting empty label list.");
		setOutput("labels", "");
		process.exit(0);
	}

	const config = parseSimpleYaml(configText);

	// 3. Match each file against each label's patterns. Multi-label mode:
	// every label whose pattern set matches at least one file gets emitted.
	const matched = new Set();
	for (const [labelAlias, patterns] of Object.entries(config)) {
		for (const pattern of patterns) {
			if (allFiles.some((f) => globMatch(f, pattern))) {
				matched.add(labelAlias);
				break;
			}
		}
	}

	const aliases = Array.from(matched);
	console.log(`🏷️ Matched labels: ${aliases.length ? aliases.join(", ") : "(none)"}`);
	setOutput("labels", aliases.join(","));
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
