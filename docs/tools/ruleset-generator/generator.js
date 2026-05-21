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
				allowed_merge_methods: ["squash"]
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

	function buildMaster(opts) {
		return {
			name: "Protect Master",
			target: "branch",
			enforcement: "active",
			conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
			rules: [
				{ type: "deletion" },
				{ type: "non_fast_forward" },
				{ type: "required_signatures" },
				pullRequestRule({ approvals: opts.approvals, requireCodeOwner: false }),
				{ type: "required_linear_history" },
				codeScanningRule(),
				requiredStatusChecksRule(),
				{ type: "copilot_code_review" }
			],
			bypass_actors: bypassDefault()
		};
	}

	function buildNext(opts) {
		return {
			name: "Protect Next",
			target: "branch",
			enforcement: "active",
			conditions: { ref_name: { exclude: [], include: ["refs/heads/next"] } },
			rules: [
				{ type: "deletion" },
				{ type: "non_fast_forward" },
				{ type: "required_signatures" },
				pullRequestRule({ approvals: opts.approvals, requireCodeOwner: false }),
				codeScanningRule(),
				requiredStatusChecksRule()
			],
			bypass_actors: bypassDefault()
		};
	}

	function buildHotfix(opts) {
		return {
			name: "Protect Hotfix",
			target: "branch",
			enforcement: "active",
			conditions: { ref_name: { exclude: [], include: ["refs/heads/hotfix"] } },
			rules: [
				{ type: "deletion" },
				{ type: "non_fast_forward" },
				{ type: "required_signatures" },
				pullRequestRule({ approvals: opts.approvals, requireCodeOwner: opts.hotfixCodeOwner }),
				{ type: "required_linear_history" },
				codeScanningRule(),
				requiredStatusChecksRule(),
				{ type: "copilot_code_review" }
			],
			bypass_actors: bypassDefault()
		};
	}

	const BUILDERS = { master: buildMaster, next: buildNext, hotfix: buildHotfix };

	function teamSizeToApprovals(size) {
		if (size === 1) return 1;
		if (size >= 2 && size <= 4) return 1;
		return 2;
	}

	function readOpts() {
		const approvals = Math.max(0, parseInt(document.getElementById("approvals").value, 10) || 0);
		const hotfixCodeOwner = document.getElementById("hotfix-codeowner").checked;
		return { approvals, hotfixCodeOwner };
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
