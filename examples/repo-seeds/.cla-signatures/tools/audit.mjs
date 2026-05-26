#!/usr/bin/env node
/**
 * @fileoverview Audit tool for the CLDMV CLA signatures ledger.
 *
 * Walks both the default-scope tree (signatures/<platform>/v<X.Y>/...) and
 * the override-scope tree (signatures/<platform>/overrides/<owner>/<repo>/v<X.Y>/...).
 * Resolves a GitHub login or numeric user ID to every signature on file for
 * that signer. Also supports listing every signer for a given (scope, version).
 *
 * Run from the root of a clone of CLDMV/.cla-signatures.
 *
 * Usage:
 *   node tools/audit.mjs <login-or-id>
 *   node tools/audit.mjs --version v1.0                    # default scope only
 *   node tools/audit.mjs --version v1.0 --scope overrides  # all overrides at v1.0
 *   node tools/audit.mjs --version v1.0 --scope override:<owner>/<repo>
 *   node tools/audit.mjs --help
 *
 * @module @cldmv/.cla-signatures.tools.audit
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORM_DEFAULT = "github";

function usage() {
	process.stdout.write(
		[
			"Usage:",
			"  node tools/audit.mjs <login-or-id>           Look up a contributor's signatures (all scopes)",
			"  node tools/audit.mjs --version <vX.Y>        List signers for that version in the default scope",
			"  node tools/audit.mjs --version <vX.Y> \\",
			"          --scope overrides                   List signers across ALL override scopes at that version",
			"  node tools/audit.mjs --version <vX.Y> \\",
			"          --scope override:<owner>/<repo>     List signers for one specific override scope",
			"  node tools/audit.mjs --help",
			"",
			"Options:",
			"  --platform <name>     Platform bucket to search (default: github)",
			"  --scope <kind>        For --version: 'default' (default), 'overrides', or 'override:<owner>/<repo>'",
			"  --raw                 Print raw JSON instead of summary",
			""
		].join("\n")
	);
}

function parseArgs(argv) {
	const args = {
		platform: PLATFORM_DEFAULT,
		raw: false,
		version: null,
		scope: "default",
		target: null,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--help" || a === "-h") args.help = true;
		else if (a === "--raw") args.raw = true;
		else if (a === "--platform") args.platform = argv[++i];
		else if (a === "--version") args.version = argv[++i];
		else if (a === "--scope") args.scope = argv[++i];
		else if (!args.target) args.target = a;
		else {
			process.stderr.write(`Unexpected argument: ${a}\n`);
			process.exit(2);
		}
	}
	return args;
}

function shardFor(id) {
	return createHash("sha256").update(String(id)).digest("hex").slice(0, 3);
}

async function resolveLoginToId(login) {
	const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
		headers: { Accept: "application/vnd.github+json" }
	});
	if (!res.ok) {
		throw new Error(`Could not resolve login "${login}": ${res.status} ${res.statusText}`);
	}
	const body = await res.json();
	return String(body.id);
}

async function pathExists(p) {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Find default-scope signature files for a given user ID.
 * Returns an array of { scope, version, path } entries.
 */
async function findDefaultSignaturesForId(platform, id) {
	const platformDir = join(REPO_ROOT, "signatures", platform);
	if (!(await pathExists(platformDir))) return [];
	const entries = await readdir(platformDir, { withFileTypes: true });
	const shard = shardFor(id);
	const found = [];
	for (const v of entries) {
		if (!v.isDirectory()) continue;
		if (v.name === "overrides") continue; // handled separately
		const file = join(platformDir, v.name, shard, `${id}.json`);
		if (await pathExists(file)) {
			found.push({ scope: "default", version: v.name, path: file });
		}
	}
	return found;
}

/**
 * Find override-scope signature files for a given user ID.
 * Walks signatures/<platform>/overrides/<owner>/<repo>/<version>/<shard>/<id>.json.
 */
async function findOverrideSignaturesForId(platform, id) {
	const overridesDir = join(REPO_ROOT, "signatures", platform, "overrides");
	if (!(await pathExists(overridesDir))) return [];
	const shard = shardFor(id);
	const found = [];
	const owners = await readdir(overridesDir, { withFileTypes: true });
	for (const o of owners) {
		if (!o.isDirectory()) continue;
		const ownerDir = join(overridesDir, o.name);
		const repos = await readdir(ownerDir, { withFileTypes: true });
		for (const r of repos) {
			if (!r.isDirectory()) continue;
			const repoDir = join(ownerDir, r.name);
			const versions = await readdir(repoDir, { withFileTypes: true });
			for (const v of versions) {
				if (!v.isDirectory()) continue;
				const file = join(repoDir, v.name, shard, `${id}.json`);
				if (await pathExists(file)) {
					found.push({ scope: `override:${o.name}/${r.name}`, version: v.name, path: file });
				}
			}
		}
	}
	return found;
}

async function findAllSignaturesForId(platform, id) {
	const [defaults, overrides] = await Promise.all([
		findDefaultSignaturesForId(platform, id),
		findOverrideSignaturesForId(platform, id)
	]);
	return [...defaults, ...overrides];
}

async function listFilesInShardTree(dir) {
	if (!(await pathExists(dir))) return [];
	const shards = await readdir(dir, { withFileTypes: true });
	const records = [];
	for (const s of shards) {
		if (!s.isDirectory()) continue;
		const shardDir = join(dir, s.name);
		const files = await readdir(shardDir);
		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			records.push(join(shardDir, f));
		}
	}
	return records;
}

async function listSignersForVersion(platform, version, scope) {
	const platformDir = join(REPO_ROOT, "signatures", platform);
	if (!(await pathExists(platformDir))) return [];

	if (scope === "default") {
		return listFilesInShardTree(join(platformDir, version));
	}

	if (scope === "overrides") {
		// All overrides at that version, across every (owner, repo).
		const overridesDir = join(platformDir, "overrides");
		if (!(await pathExists(overridesDir))) return [];
		const out = [];
		const owners = await readdir(overridesDir, { withFileTypes: true });
		for (const o of owners) {
			if (!o.isDirectory()) continue;
			const ownerDir = join(overridesDir, o.name);
			const repos = await readdir(ownerDir, { withFileTypes: true });
			for (const r of repos) {
				if (!r.isDirectory()) continue;
				const verDir = join(ownerDir, r.name, version);
				out.push(...(await listFilesInShardTree(verDir)));
			}
		}
		return out;
	}

	// scope = "override:<owner>/<repo>"
	const m = /^override:([^/]+)\/(.+)$/.exec(scope);
	if (!m) {
		throw new Error(`Unrecognized --scope value: ${scope}`);
	}
	const [, ownerName, repoName] = m;
	return listFilesInShardTree(join(platformDir, "overrides", ownerName, repoName, version));
}

function summarize(record) {
	const s = record.signer ?? {};
	const a = record.agreement ?? {};
	const c = record.context ?? {};
	const src = record.source ?? {};
	return [
		`Signer       : @${s.github_login_at_signing ?? "?"} (id=${s.platform_user_id ?? "?"})`,
		`Scope        : ${a.cla_scope ?? "?"}`,
		`CLA version  : ${a.cla_version ?? "?"}`,
		`Signed at    : ${src.comment_created_at ?? record.bot?.recorded_at ?? "?"}`,
		`Triggered by : ${c.consumer_repo ?? "?"} PR #${c.pr_number ?? "?"} (${c.pr_url ?? ""})`,
		`Comment      : ${src.comment_url ?? "?"}`,
		`CLA SHA-256  : ${a.cla_sha256 ?? "?"}`,
		`Record SHA   : ${record.signature_id ?? "?"}`
	].join("\n");
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || (!args.target && !args.version)) {
		usage();
		process.exit(args.help ? 0 : 2);
	}

	if (args.version) {
		const files = await listSignersForVersion(args.platform, args.version, args.scope);
		const scopeLabel = args.scope === "default" ? "default scope" : args.scope;
		if (files.length === 0) {
			process.stdout.write(`No signatures found for ${args.platform}/${args.version} (${scopeLabel}).\n`);
			process.exit(0);
		}
		process.stdout.write(`Signatures for ${args.platform}/${args.version} (${scopeLabel}) — ${files.length}:\n`);
		for (const f of files) {
			const body = JSON.parse(await readFile(f, "utf8"));
			const s = body.signer ?? {};
			const a = body.agreement ?? {};
			process.stdout.write(`  @${s.github_login_at_signing ?? "?"} (id=${s.platform_user_id ?? "?"}; scope=${a.cla_scope ?? "?"})\n`);
		}
		return;
	}

	const target = args.target;
	let id = /^\d+$/.test(target) ? target : null;
	if (!id) {
		id = await resolveLoginToId(target);
	}
	const found = await findAllSignaturesForId(args.platform, id);
	if (found.length === 0) {
		process.stdout.write(`No signatures found for ${args.platform} user id=${id}.\n`);
		process.exit(0);
	}

	for (const { scope, version, path } of found) {
		const body = JSON.parse(await readFile(path, "utf8"));
		process.stdout.write(`\n=== ${args.platform}/${scope}/${version} (${path}) ===\n`);
		if (args.raw) {
			process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
		} else {
			process.stdout.write(`${summarize(body)}\n`);
		}
	}
}

main().catch((err) => {
	process.stderr.write(`${err.message}\n`);
	process.exit(1);
});
