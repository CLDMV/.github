/**
 * @fileoverview One-time-setup script: install CLDMV's branch-naming
 * convention as an org-level GitHub Ruleset. Idempotent — re-running
 * updates the existing ruleset (matched by name).
 *
 * Run: GH_TOKEN=<App-or-PAT-with-org:admin> node scripts/setup-org-rulesets.mjs
 *
 * Requires the bot App (or a PAT) to have org-level "Manage organization
 * rulesets" permission.
 *
 * Batch 1.3a from tmp/plan-future-workflows.md.
 * @module @cldmv/.github.scripts.setup-org-rulesets
 */

const ORG = process.env.ORG || "CLDMV";
const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) {
	console.error("ERROR: GH_TOKEN env var must be set with a token having org:admin");
	process.exit(1);
}

const RULESET = {
	name: "CLDMV branch naming convention",
	target: "branch",
	enforcement: "active",
	conditions: {
		ref_name: { include: ["~ALL"], exclude: [] },
		repository_name: { include: ["~ALL"], exclude: [] }
	},
	rules: [
		{
			type: "creation",
			parameters: {
				restrict_creations: true,
				allowed_name_patterns: [
					"release/[0-9]+\\.[0-9]+\\.[0-9]+",
					"hotfix/[0-9]+\\.[0-9]+\\.[0-9]+",
					"feat/*",
					"fix/*",
					"chore/*",
					"docs/*",
					"ci/*",
					"refactor/*",
					"perf/*",
					"test/*",
					"style/*",
					"dependabot/*",
					"copilot/*",
					"master",
					"main",
					"badges",
					"gh-pages"
				]
			}
		}
	],
	bypass_actors: [{ actor_type: "OrganizationAdmin", bypass_mode: "always" }]
};

async function api(method, path, body) {
	const res = await fetch(`https://api.github.com${path}`, {
		method,
		headers: {
			"Authorization": `Bearer ${TOKEN}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2026-03-10",
			"Content-Type": "application/json"
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
	}
	return res.status === 204 ? null : await res.json();
}

(async () => {
	// Find existing ruleset by name
	const existing = await api("GET", `/orgs/${ORG}/rulesets`);
	const match = Array.isArray(existing) ? existing.find((r) => r.name === RULESET.name) : null;

	if (match) {
		console.log(`Updating existing ruleset #${match.id} "${RULESET.name}"…`);
		await api("PUT", `/orgs/${ORG}/rulesets/${match.id}`, RULESET);
		console.log("✅ Updated.");
	} else {
		console.log(`Creating new ruleset "${RULESET.name}" on org "${ORG}"…`);
		const created = await api("POST", `/orgs/${ORG}/rulesets`, RULESET);
		console.log(`✅ Created ruleset #${created?.id}`);
	}
})().catch((err) => {
	console.error(`ERROR: ${err.message}`);
	process.exit(1);
});
