/**
 * @fileoverview Pure-ESM ruleset builders. No DOM access — safe to load from
 * the browser tool (via `<script type="module">`) OR from the Node-based
 * org-bootstrap action. The browser tool is the UI; the bootstrap action is
 * the org-wide fanout. Single source of truth so the defaults can't drift.
 *
 * @module @cldmv/.github.docs.tools.ruleset-generator.builders
 */

const REQUIRED_CHECK_NAME = "✅ Required PR Check";

/**
 * CLDMV bot App default ID, used to pre-add the bot to next/hotfixes
 * bypass_actors. Override per-org by passing `botAppId` in opts.
 */
export const DEFAULT_BOT_APP_ID = 1910694;

function pullRequestRule(opts) {
	return {
		type: "pull_request",
		parameters: {
			required_approving_review_count: opts.approvals,
			dismiss_stale_reviews_on_push: true,
			required_reviewers: [],
			require_code_owner_review: !!opts.requireCodeOwner,
			require_last_push_approval: false,
			required_review_thread_resolution: true,
			// Per-branch merge method:
			//   - master:           squash only        — release PRs land as a single signed commit
			//   - next / hotfixes:  merge-commit only  — preserves the PR's signed commits intact
			allowed_merge_methods: Array.isArray(opts.mergeMethods) && opts.mergeMethods.length > 0 ? opts.mergeMethods : ["squash"]
		}
	};
}

function codeScanningRule() {
	return {
		type: "code_scanning",
		parameters: {
			code_scanning_tools: [
				{
					tool: "CodeQL",
					security_alerts_threshold: "high_or_higher",
					alerts_threshold: "errors_and_warnings"
				}
			]
		}
	};
}

function requiredStatusChecksRule() {
	return {
		type: "required_status_checks",
		parameters: {
			strict_required_status_checks_policy: false,
			do_not_enforce_on_create: true,
			required_status_checks: [{ context: REQUIRED_CHECK_NAME }]
		}
	};
}

function bypassDefault() {
	return [
		{
			actor_id: null,
			actor_type: "OrganizationAdmin",
			bypass_mode: "always"
		}
	];
}

// next/hotfixes also bypass the bot App (the v4 reset/merge workflows mutate
// those branches as the App). master deliberately does NOT — it only changes
// via a reviewed squash. The bot actor is added ONLY when opted in AND a valid
// positive integer App ID is supplied; opting out, or a blank/non-numeric ID,
// yields admin-only bypass.
function bypassWithBot(includeBot, botAppId) {
	const actors = bypassDefault();
	if (includeBot && Number.isInteger(botAppId) && botAppId > 0) {
		actors.push({
			actor_id: botAppId,
			actor_type: "Integration",
			bypass_mode: "always"
		});
	}
	return actors;
}

/**
 * @param {object} opts - { approvals, hotfixCodeOwner, copilotReview, includeBot, botAppId }
 */
export function buildMaster(opts) {
	// master PRs are release-bundle PRs opened from next/hotfixes by the
	// release-flow workflows — every commit in them was already reviewed
	// on next or hotfixes when it landed. Code review (human or Copilot)
	// adds no signal here. The PR review on master is essentially "approve
	// the version bump and changelog".
	const rules = [
		{ type: "deletion" },
		{ type: "non_fast_forward" },
		{ type: "required_signatures" },
		pullRequestRule({ approvals: opts.approvals, requireCodeOwner: false, mergeMethods: ["squash"] }),
		{ type: "required_linear_history" },
		codeScanningRule(),
		requiredStatusChecksRule()
	];
	return {
		name: "Protect Master",
		target: "branch",
		enforcement: "active",
		conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
		rules: rules,
		bypass_actors: bypassDefault()
	};
}

/**
 * @param {object} opts - { approvals, hotfixCodeOwner, copilotReview, includeBot, botAppId }
 */
export function buildNext(opts) {
	// next is where feature PRs land. This is the primary code-review
	// gate, so the Copilot opt-in (and code-scanning, status checks)
	// belong here — not on master. Merge-commit only (signatures preserved
	// vs. "Rebase and merge" which strips them server-side).
	const rules = [
		{ type: "deletion" },
		{ type: "non_fast_forward" },
		{ type: "required_signatures" },
		pullRequestRule({ approvals: opts.approvals, requireCodeOwner: false, mergeMethods: ["merge"] }),
		codeScanningRule(),
		requiredStatusChecksRule()
	];
	if (opts.copilotReview) rules.push({ type: "copilot_code_review" });
	return {
		name: "Protect Next",
		target: "branch",
		enforcement: "active",
		conditions: { ref_name: { exclude: [], include: ["refs/heads/next"] } },
		rules: rules,
		bypass_actors: bypassWithBot(opts.includeBot, opts.botAppId)
	};
}

/**
 * @param {object} opts - { approvals, hotfixCodeOwner, copilotReview, includeBot, botAppId }
 */
export function buildHotfix(opts) {
	// Same merge-commit-only policy as next: preserves the PR's signed
	// commits intact. The master squash absorbs the merge-commit noise.
	const rules = [
		{ type: "deletion" },
		{ type: "non_fast_forward" },
		{ type: "required_signatures" },
		pullRequestRule({ approvals: opts.approvals, requireCodeOwner: opts.hotfixCodeOwner, mergeMethods: ["merge"] }),
		{ type: "required_linear_history" },
		codeScanningRule(),
		requiredStatusChecksRule()
	];
	if (opts.copilotReview) rules.push({ type: "copilot_code_review" });
	return {
		name: "Protect Hotfixes",
		target: "branch",
		enforcement: "active",
		conditions: { ref_name: { exclude: [], include: ["refs/heads/hotfixes"] } },
		rules: rules,
		bypass_actors: bypassWithBot(opts.includeBot, opts.botAppId)
	};
}

export const BUILDERS = { master: buildMaster, next: buildNext, hotfixes: buildHotfix };

/**
 * Map a rough team-size bucket to a sensible required-approvals default.
 * Used by the browser tool's "Team size" pre-fill.
 */
export function teamSizeToApprovals(size) {
	if (size === 1) return 1;
	if (size >= 2 && size <= 4) return 1;
	return 2;
}

/**
 * Org-default opts — what the org-onboarding fanout uses for every repo
 * unless explicitly overridden. Matches the browser tool's defaults
 * (1 approval, no hotfix code-owner gate, no Copilot, bot App pre-added
 * to bypass on next/hotfixes).
 */
export const DEFAULT_OPTS = Object.freeze({
	approvals: 1,
	hotfixCodeOwner: false,
	copilotReview: false,
	includeBot: true,
	botAppId: DEFAULT_BOT_APP_ID
});

/**
 * Build all three rulesets in one call with the org defaults. Returns
 * `{ master, next, hotfixes }`. Used by the bootstrap action; callers can
 * spread a partial override (e.g. `{ ...DEFAULT_OPTS, copilotReview: true }`).
 */
export function buildAll(opts = DEFAULT_OPTS) {
	return {
		master: buildMaster(opts),
		next: buildNext(opts),
		hotfixes: buildHotfix(opts)
	};
}
