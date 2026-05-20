/**
 * @fileoverview Post a welcome comment on a contributor's first issue/PR.
 * Detects which guidance docs exist (CONTRIBUTING.md, CLA.md, CODE_OF_CONDUCT.md)
 * and conditionally includes corresponding sections via a tiny Mustache-subset
 * template substitutor. Batch 5.3.
 * @module @cldmv/.github.github.jobs.welcome-contributor
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";
import { api } from "../../api/_api/core.mjs";

/** Substitute `{{var}}` placeholders and `{{#section}}...{{/section}}` blocks. */
function substitute(template, vars) {
	// Conditional blocks first (multiline, non-greedy)
	let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => (vars[key] ? body : ""));
	// Variable substitution
	out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ""));
	// Collapse 3+ newlines to 2 (cleanup pass after sections drop)
	out = out.replace(/\n{3,}/g, "\n\n").trim() + "\n";
	return out;
}

/** Returns true if `path` exists in the repo at the default branch. */
async function fileExists({ token, owner, repo, path }) {
	try {
		await api("GET", `/contents/${encodeURIComponent(path)}`, null, { token, owner, repo });
		return true;
	} catch (err) {
		if (err.message.includes("404")) return false;
		throw err;
	}
}

/** Fetch raw file content from a repo at a ref. Returns null on 404. */
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

try {
	const token = getInput("github_token", { required: true });
	const exemptList = (getInput("exempt_logins") || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const prTemplatePath = getInput("pr_message_path");
	const issueTemplatePath = getInput("issue_message_path");
	const defaultRepo = getInput("default_template_repo") || "CLDMV/.github";
	const defaultRef = getInput("default_template_ref") || "v2";
	const defaultPrPath = getInput("default_pr_template_path") || ".github/templates/welcome-pr.md";
	const defaultIssuePath = getInput("default_issue_template_path") || ".github/templates/welcome-issue.md";

	const repository = process.env.GITHUB_REPOSITORY || "";
	const [owner, repo] = repository.split("/");

	const eventName = process.env.GITHUB_EVENT_NAME;
	const eventPath = process.env.GITHUB_EVENT_PATH;
	if (!eventPath) throw new Error("GITHUB_EVENT_PATH not set");
	const fs = await import("node:fs");
	const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));

	const isPR = eventName === "pull_request" || eventName === "pull_request_target";
	const obj = isPR ? event.pull_request : event.issue;
	if (!obj) {
		console.log(`ℹ️ No issue/PR in event ${eventName}; nothing to welcome.`);
		process.exit(0);
	}
	const author = obj.user?.login || "";
	const number = obj.number;

	if (exemptList.includes(author)) {
		console.log(`ℹ️ ${author} is in exempt list; skipping.`);
		process.exit(0);
	}

	// Count prior interactions by this author in this repo.
	const type = isPR ? "pr" : "issue";
	const searchQuery = encodeURIComponent(`author:${author} repo:${owner}/${repo} type:${type}`);
	const search = await api("GET", `/search/issues?q=${searchQuery}`, null, { token, owner: null, repo: null });
	const priorCount = search?.total_count || 0;
	console.log(`📊 ${author} has ${priorCount} prior ${type}(s) in ${owner}/${repo}.`);

	// total_count includes the current item. <=1 means this IS their first.
	if (priorCount > 1) {
		console.log(`ℹ️ Not first ${type} from ${author}; skipping welcome.`);
		process.exit(0);
	}

	// Probe which docs exist in this repo
	const hasContributing = await fileExists({ token, owner, repo, path: "CONTRIBUTING.md" });
	const hasCla = await fileExists({ token, owner, repo, path: "CLA.md" });
	const hasCoc = await fileExists({ token, owner, repo, path: "CODE_OF_CONDUCT.md" });

	const vars = {
		author,
		repo: `${owner}/${repo}`,
		contributing: hasContributing,
		contributing_url: hasContributing ? `https://github.com/${owner}/${repo}/blob/HEAD/CONTRIBUTING.md` : "",
		cla: isPR && hasCla, // CLA only for PRs (code contributions)
		cla_url: hasCla ? `https://github.com/${owner}/${repo}/blob/HEAD/CLA.md` : "",
		coc: hasCoc,
		coc_url: hasCoc ? `https://github.com/${owner}/${repo}/blob/HEAD/CODE_OF_CONDUCT.md` : "",
		hasGuidance: hasContributing || (isPR && hasCla) || hasCoc
	};

	// Pick template — per-repo override else org default
	const overridePath = isPR ? prTemplatePath : issueTemplatePath;
	const orgPath = isPR ? defaultPrPath : defaultIssuePath;
	let template = null;
	if (overridePath) {
		template = await readFile({ token, owner, repo, path: overridePath, ref: null });
		if (template) console.log(`📋 Using per-repo template: ${overridePath}`);
	}
	if (!template) {
		const [defOwner, defRepo] = defaultRepo.split("/");
		template = await readFile({ token, owner: defOwner, repo: defRepo, path: orgPath, ref: defaultRef });
		if (template) console.log(`📋 Using org-default template: ${defaultRepo}@${defaultRef}:${orgPath}`);
	}
	if (!template) {
		console.log("::warning::No welcome template found; skipping comment.");
		process.exit(0);
	}

	const body = substitute(template, vars);
	console.log(`💬 Posting welcome comment to ${type} #${number}`);
	await api("POST", `/issues/${number}/comments`, { body }, { token, owner, repo });
	appendSummary(`💬 Welcomed @${author} on ${type} #${number}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
