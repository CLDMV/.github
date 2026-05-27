/**
 * @fileoverview Browser UI shim for the ruleset generator. The builder logic
 * lives in `builders.mjs` so it can be shared with the Node-based
 * org-bootstrap action. This file is the form-reading / preview / download
 * UI layer only.
 *
 * Loaded as an ES module from index.html: `<script type="module" src="generator.js">`.
 */

import { BUILDERS, teamSizeToApprovals } from "./builders.mjs";

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
