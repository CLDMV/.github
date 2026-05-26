(function () {
	"use strict";

	const REQUIRED_CHECK_NAME = "✅ Required PR Check";

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
				//   - master: squash only — release PRs land as a single clean
				//     commit on the released line; individual commit history
				//     of the staging branches is preserved inside the squash's
				//     body as a categorized changelog.
				//   - next / hotfixes: rebase only — individual commits from
				//     feature PRs are preserved linearly; GitHub appends
				//     (#N) to commit subjects, so the to-master release PR's
				//     changelog gets PR refs for free without re-running
				//     anything.
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

	function buildMaster(opts) {
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

	function buildNext(opts) {
		// next is where feature PRs land. This is the primary code-review
		// gate, so the Copilot opt-in (and code-scanning, status checks)
		// belong here — not on master.
		//
		// **Merge-commit only.** GitHub's "Rebase and merge" web-UI button
		// re-creates the PR's commits server-side and does NOT preserve
		// their GPG signatures — every rebased commit lands unsigned, even
		// when the source PR's commits were all signed (documented limitation).
		// "Create a merge commit" keeps the original commits intact
		// (signatures and all) and adds a single merge commit on top.
		//
		// The merge-commit gives a slightly noisier git log on `next`, but
		// that's invisible at the master level: master uses squash (above),
		// which collapses the entire `next..master` range — merge commits
		// included — into one clean signed commit per release.
		//
		// Squash is also off `next` so a maintainer doesn't accidentally
		// squash a multi-commit PR (losing the individual signed commits)
		// when they meant to preserve them.
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

	function buildHotfix(opts) {
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

	const BUILDERS = { master: buildMaster, next: buildNext, hotfixes: buildHotfix };

	function teamSizeToApprovals(size) {
		if (size === 1) return 1;
		if (size >= 2 && size <= 4) return 1;
		return 2;
	}

	function readOpts() {
		const approvals = Math.max(0, parseInt(document.getElementById("approvals").value, 10) || 0);
		const hotfixCodeOwner = document.getElementById("hotfix-codeowner").checked;
		const copilotReview = document.getElementById("copilot-review").checked;
		const includeBot = document.getElementById("include-bot-bypass").checked;
		// parseInt of "" or non-numeric → NaN; bypassWithBot rejects anything not a
		// positive integer, so a blank/garbage field simply omits the bot actor.
		const botAppId = parseInt(document.getElementById("bot-app-id").value, 10);
		return { approvals, hotfixCodeOwner, copilotReview, includeBot, botAppId };
	}

	function refresh() {
		const opts = readOpts();
		for (const branch of Object.keys(BUILDERS)) {
			const json = BUILDERS[branch](opts);
			document.getElementById("preview-" + branch).textContent = JSON.stringify(json, null, 2);
		}
	}

	function download(branch) {
		const opts = readOpts();
		const json = BUILDERS[branch](opts);
		const blob = new Blob([JSON.stringify(json, null, 2) + "\n"], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = branch + ".json";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	document.addEventListener("DOMContentLoaded", function () {
		document.getElementById("approvals").addEventListener("input", refresh);
		document.getElementById("hotfix-codeowner").addEventListener("change", refresh);
		document.getElementById("copilot-review").addEventListener("change", refresh);
		document.getElementById("include-bot-bypass").addEventListener("change", refresh);
		document.getElementById("bot-app-id").addEventListener("input", refresh);
		document.getElementById("team-size").addEventListener("change", function (e) {
			const size = parseInt(e.target.value, 10);
			if (size > 0) {
				document.getElementById("approvals").value = teamSizeToApprovals(size);
				refresh();
			}
		});
		document.querySelectorAll("button[data-branch]").forEach(function (btn) {
			btn.addEventListener("click", function () {
				download(btn.dataset.branch);
			});
		});
		refresh();
	});
})();
