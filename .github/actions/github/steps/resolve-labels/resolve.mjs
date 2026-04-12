/**
 *	@Project: resolve-labels
 *	@Filename: /resolve.mjs
 *	@Description: Resolves comma-separated label aliases to canonical names from
 *	              data/github-labels.json. Reads INPUT_ALIASES from the environment
 *	              and writes resolved label names to $GITHUB_OUTPUT.
 */

import { appendFileSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Navigate from .github/actions/github/steps/resolve-labels/ up to the repo root,
// then into data/github-labels.json
const labelsPath = resolve(__dirname, "../../../../../data/github-labels.json");

/**
 * Loads github-labels.json and builds a case-insensitive map of alias → canonical name.
 * The label's own name is also treated as an alias of itself.
 * @returns {Map<string, string>} alias (lowercase) → canonical label name
 */
function buildAliasMap() {
	const labels = JSON.parse(readFileSync(labelsPath, "utf8"));
	const map = new Map();
	for (const label of labels) {
		map.set(label.name.toLowerCase(), label.name);
		if (Array.isArray(label.aliases)) {
			for (const alias of label.aliases) {
				map.set(alias.toLowerCase(), label.name);
			}
		}
	}
	return map;
}

/**
 * Resolves a comma-separated string of label aliases to canonical names.
 * Unknown aliases are passed through as-is with a warning so nothing silently vanishes.
 * @param {string} aliases - Comma-separated alias string (e.g. "release,patch,bug")
 * @param {Map<string, string>} aliasMap - Alias → canonical name map
 * @returns {string} Comma-separated canonical label names
 */
function resolveAliases(aliases, aliasMap) {
	return aliases
		.split(",")
		.map((a) => a.trim())
		.filter(Boolean)
		.map((alias) => {
			const canonical = aliasMap.get(alias.toLowerCase());
			if (!canonical) {
				console.warn(`⚠️  No label found for alias "${alias}" — using as-is`);
				return alias;
			}
			return canonical;
		})
		.join(",");
}

const inputAliases = process.env.INPUT_ALIASES || "";

if (!inputAliases.trim()) {
	console.error("❌ INPUT_ALIASES is empty — nothing to resolve");
	process.exit(1);
}

const aliasMap = buildAliasMap();
const resolved = resolveAliases(inputAliases, aliasMap);

console.log(`🏷️  Input aliases : ${inputAliases}`);
console.log(`✅  Resolved labels: ${resolved}`);

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
	appendFileSync(githubOutput, `labels=${resolved}\n`);
}
