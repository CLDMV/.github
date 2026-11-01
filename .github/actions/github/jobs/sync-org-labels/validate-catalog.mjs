/**
 *	@Project: sync-org-labels
 *	@Filename: /validate-catalog.mjs
 *	@Description: Checks the label catalog (data/github-labels.json) against the
 *	              limits GitHub enforces on labels, so a bad entry fails the sync
 *	              once, before any repo is touched, instead of erroring in every
 *	              repo with HTTP 422.
 */

/** GitHub's label name limit, in code points. */
export const NAME_MAX = 50;

/** GitHub's label description limit, in code points. */
export const DESCRIPTION_MAX = 100;

/**
 * Validates every catalog entry. Lengths are counted in code points, as GitHub
 * counts them. Names and aliases are compared case-insensitively, because the
 * sync resolves both through one lowercased map: a key owned by two entries
 * would rename one label into the other.
 * @param {unknown} labels - parsed contents of data/github-labels.json
 * @returns {string[]} one message per problem; empty when the catalog is valid
 */
export function validateLabelCatalog(labels) {
	if (!Array.isArray(labels)) return ["the catalog must be a JSON array of label objects"];

	const problems = [];
	const owners = new Map();

	labels.forEach((label, index) => {
		const name = typeof label?.name === "string" ? label.name : "";
		const where = name ? `"${name}"` : `entry ${index}`;

		if (!name.trim()) {
			problems.push(`${where} has no name`);
		} else if ([...name].length > NAME_MAX) {
			problems.push(`name of ${where} is ${[...name].length} characters (max ${NAME_MAX})`);
		}

		if (typeof label?.color !== "string" || !/^[0-9a-f]{6}$/i.test(label.color)) {
			problems.push(`colour of ${where} is ${JSON.stringify(label?.color)} (must be 6 hex digits, no #)`);
		}

		const description = label?.description ?? "";
		if (typeof description !== "string") {
			problems.push(`description of ${where} must be a string`);
		} else if ([...description].length > DESCRIPTION_MAX) {
			problems.push(`description of ${where} is ${[...description].length} characters (max ${DESCRIPTION_MAX})`);
		}

		const aliases = label?.aliases ?? [];
		if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== "string")) {
			problems.push(`aliases of ${where} must be an array of strings`);
			return;
		}

		for (const key of new Set([name, ...aliases].filter(Boolean).map((k) => k.toLowerCase()))) {
			if (!owners.has(key)) owners.set(key, []);
			owners.get(key).push(name || `entry ${index}`);
		}
	});

	for (const [key, names] of owners) {
		if (names.length > 1) problems.push(`"${key}" is a name or alias of more than one label: ${names.join(" / ")}`);
	}

	return problems;
}
