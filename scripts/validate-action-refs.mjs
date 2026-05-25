#!/usr/bin/env node
/**
 * @fileoverview Validator for GitHub Actions workflow / action references.
 *
 * Catches two classes of bug that `actionlint` and pure YAML parsing miss:
 *
 * 1. **Invalid local action inputs** — when a workflow or composite action
 *    uses another local action (under .github/actions/) and passes an input
 *    name that the called action's `inputs:` section doesn't declare.
 *    Example: passing `ref:` to a wrapper that only accepts `fetch-depth`.
 *
 * 2. **Nonexistent remote action versions** — when a workflow references
 *    `owner/repo@<version>` and that ref doesn't resolve on GitHub. Handles
 *    both tags and 40-char SHA pins (verified via `git ls-remote`).
 *    Example: `aquasecurity/trivy-action@0.28.0` (no such tag).
 *
 * Designed to run as a step in local-ci.yml. Exits 1 on any finding; writes
 * a per-finding section to $GITHUB_STEP_SUMMARY when running under Actions.
 *
 * Self-contained. Uses Node built-ins only — no `npm install` required.
 *
 * Local run for ad-hoc validation: `node scripts/validate-action-refs.mjs`.
 *
 * @module @cldmv/.github.scripts.validate-action-refs
 */

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execSync } from "node:child_process";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SELF_REPO = "CLDMV/.github"; // self-references resolve to local paths

// ---- helpers ---------------------------------------------------------------

/** Append a line to the GHA step summary when running in Actions. */
function appendSummary(text) {
	if (!process.env.GITHUB_STEP_SUMMARY) return;
	try {
		require("node:fs").appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
	} catch {
		/* ignore */
	}
}

/** List every workflow + action.yml file in the repo. */
function listYamlFiles() {
	const out = execSync(
		`find ${REPO_ROOT}/.github/workflows ${REPO_ROOT}/.github/actions -name '*.yml' -type f`,
		{ encoding: "utf8" }
	);
	return out.trim().split("\n").filter(Boolean);
}

/**
 * Crude YAML parser tailored to our needs: extracts every `uses:` reference
 * plus the `with:` inputs that follow at the deeper indent level, until a
 * sibling/parent key appears.
 *
 * Returns array of: { file, line, uses, inputs: { name: line } }
 */
function extractUsesBlocks(file) {
	const lines = readFileSync(file, "utf8").split("\n");
	const blocks = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const m = line.match(/^(\s*)(?:-\s+)?uses:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/);
		if (!m) continue;
		const indent = m[1].length + (line.includes("- ") ? 2 : 0);
		const uses = m[2];
		const inputs = {};
		// Look ahead for a `with:` block at the same indent as the `- uses:`
		for (let j = i + 1; j < lines.length; j++) {
			const next = lines[j];
			if (next.trim() === "" || next.trim().startsWith("#")) continue;
			const nextIndent = next.match(/^(\s*)/)[1].length;
			if (nextIndent < indent) break;
			if (nextIndent === indent && next.trim().startsWith("- ")) break;
			const wm = next.match(/^(\s*)with:\s*$/);
			if (wm && wm[1].length === indent) {
				// parse inputs under with:
				const withIndent = wm[1].length;
				for (let k = j + 1; k < lines.length; k++) {
					const inp = lines[k];
					if (inp.trim() === "" || inp.trim().startsWith("#")) continue;
					const inpIndent = inp.match(/^(\s*)/)[1].length;
					if (inpIndent <= withIndent) break;
					const im = inp.match(/^(\s*)([a-zA-Z0-9_-]+)\s*:/);
					if (im && im[1].length === withIndent + 2) {
						inputs[im[2]] = k + 1;
					}
				}
				break;
			}
		}
		blocks.push({ file, line: i + 1, uses, inputs });
	}
	return blocks;
}

/** Resolve a `uses:` ref to either a local action.yml path (if self-ref or relative) or { remote: { owner, repo, version } }. */
function resolveRef(uses, fromFile) {
	// Self-repo absolute: CLDMV/.github/.github/actions/foo@v3
	const selfMatch = uses.match(/^([\w-]+\/[\w.-]+)\/\.github\/actions\/([\w./-]+)@(.+)$/);
	if (selfMatch && selfMatch[1] === SELF_REPO) {
		return { local: join(REPO_ROOT, ".github", "actions", selfMatch[2], "action.yml") };
	}
	// Self-repo workflow ref: CLDMV/.github/.github/workflows/foo@v3 — workflow_call, skip
	if (uses.match(/^([\w-]+\/[\w.-]+)\/\.github\/workflows\/.+@.+$/)) {
		if (uses.startsWith(SELF_REPO + "/")) return { selfWorkflow: true };
		return null;
	}
	// Relative workflow_call: ./.github/workflows/foo.yml — skip (workflow, not action)
	if (uses.match(/^\.\/\.github\/workflows\/.+\.ya?ml$/)) {
		return null;
	}
	// Relative: ./.github/actions/foo
	if (uses.startsWith("./")) {
		return { local: join(REPO_ROOT, uses.replace(/^\.\//, ""), "action.yml") };
	}
	// Docker action: docker://...
	if (uses.startsWith("docker://")) return null;
	// Remote action: owner/repo@version (with optional subpath)
	const remoteMatch = uses.match(/^([\w-]+)\/([\w.-]+)(?:\/[\w./-]+)?@(.+)$/);
	if (remoteMatch) {
		return { remote: { owner: remoteMatch[1], repo: remoteMatch[2], version: remoteMatch[3] } };
	}
	return null;
}

/** Parse an action.yml's declared input names. Returns Set<string>. */
function declaredInputs(actionYmlPath) {
	if (!existsSync(actionYmlPath)) return null;
	const lines = readFileSync(actionYmlPath, "utf8").split("\n");
	const inputs = new Set();
	let inInputs = false;
	let inputsIndent = -1;
	for (const line of lines) {
		if (line.match(/^inputs:\s*$/)) {
			inInputs = true;
			inputsIndent = 0;
			continue;
		}
		if (!inInputs) continue;
		if (line.trim() === "") continue;
		const indent = line.match(/^(\s*)/)[1].length;
		if (indent <= inputsIndent && line.trim() !== "") {
			// end of inputs block
			if (line.match(/^[a-z]/)) break;
		}
		// Input name is a top-level key under inputs:
		const m = line.match(/^(\s+)([a-zA-Z0-9_-]+)\s*:/);
		if (m && m[1].length === 2) inputs.add(m[2]);
	}
	return inputs;
}

/**
 * Verify that a remote `uses:` ref's `@<version>` resolves to a real object
 * on GitHub. Handles three formats:
 *   - 40-char hex SHA pin (verify the commit object exists in the remote)
 *   - Tag (vX.Y.Z, X.Y, latest, etc.) via /releases/tag/ + ls-remote fallback
 *   - Branch — not validated here (rare for `uses:`; would need ls-remote heads)
 */
function remoteTagExists(owner, repo, version) {
	try {
		// SHA pin (40-char hex): verify the commit is reachable via ls-remote.
		// `git ls-remote` by itself returns ALL refs; grep for the SHA.
		if (/^[0-9a-f]{40}$/i.test(version)) {
			const out = execSync(`git ls-remote 'https://github.com/${owner}/${repo}.git'`, { encoding: "utf8" });
			return out.toLowerCase().includes(version.toLowerCase());
		}
		const url = `https://github.com/${owner}/${repo}/releases/tag/${version}`;
		// Use curl: shorter than fetch + handles redirects; available everywhere
		const code = execSync(`curl -sSL -o /dev/null -w '%{http_code}' '${url}'`, { encoding: "utf8" }).trim();
		if (code === "200") return true;
		// Fall back: check if the tag exists in refs/tags via git ls-remote (more authoritative)
		const ls = execSync(`git ls-remote --tags 'https://github.com/${owner}/${repo}.git' 'refs/tags/${version}'`, {
			encoding: "utf8"
		}).trim();
		return ls.length > 0;
	} catch {
		return false;
	}
}

// ---- main ------------------------------------------------------------------

const findings = [];
const files = listYamlFiles();
const remoteCache = new Map();

for (const file of files) {
	const rel = file.replace(REPO_ROOT + "/", "");
	let blocks;
	try {
		blocks = extractUsesBlocks(file);
	} catch (e) {
		findings.push({ kind: "parse", file: rel, line: 0, message: `Failed to parse: ${e.message}` });
		continue;
	}
	for (const block of blocks) {
		const ref = resolveRef(block.uses, file);
		if (!ref) continue;

		// Local action: validate inputs against declared
		if (ref.local) {
			const declared = declaredInputs(ref.local);
			if (declared === null) {
				findings.push({
					kind: "missing-action",
					file: rel,
					line: block.line,
					message: `\`uses: ${block.uses}\` references a local action.yml that doesn't exist at ${ref.local.replace(REPO_ROOT + "/", "")}`
				});
				continue;
			}
			for (const [name, inpLine] of Object.entries(block.inputs)) {
				if (!declared.has(name)) {
					findings.push({
						kind: "invalid-input",
						file: rel,
						line: inpLine,
						message: `\`${name}:\` passed to \`uses: ${block.uses}\` but that action only declares: ${[...declared].sort().join(", ") || "(no inputs)"}`
					});
				}
			}
		}

		// Remote action: verify tag exists (cached per owner/repo@version)
		if (ref.remote) {
			const key = `${ref.remote.owner}/${ref.remote.repo}@${ref.remote.version}`;
			if (!remoteCache.has(key)) {
				remoteCache.set(key, remoteTagExists(ref.remote.owner, ref.remote.repo, ref.remote.version));
			}
			if (!remoteCache.get(key)) {
				findings.push({
					kind: "bad-remote-version",
					file: rel,
					line: block.line,
					message: `\`uses: ${block.uses}\` — version not found on GitHub. Check https://github.com/${ref.remote.owner}/${ref.remote.repo}/tags`
				});
			}
		}
	}
}

// ---- report ----------------------------------------------------------------

const summary = process.env.GITHUB_STEP_SUMMARY;
const writeSum = (s) => summary && appendFileSync(summary, s + "\n");

if (findings.length === 0) {
	console.log("✅ validate-action-refs — no findings");
	writeSum("### ✅ Action-ref validator — no findings");
	process.exit(0);
}

console.error(`❌ validate-action-refs — ${findings.length} finding(s):`);
writeSum(`### ❌ Action-ref validator — ${findings.length} finding(s)`);
writeSum("");
const byFile = new Map();
for (const f of findings) {
	if (!byFile.has(f.file)) byFile.set(f.file, []);
	byFile.get(f.file).push(f);
}
for (const [file, fs] of byFile) {
	console.error(`\n${file}:`);
	writeSum(`**\`${file}\`**`);
	writeSum("");
	for (const f of fs) {
		console.error(`  L${f.line}  [${f.kind}]  ${f.message}`);
		console.error(`::error file=${file},line=${f.line}::[${f.kind}] ${f.message}`);
		writeSum(`- L${f.line} **[${f.kind}]** ${f.message}`);
	}
	writeSum("");
}
process.exit(1);
