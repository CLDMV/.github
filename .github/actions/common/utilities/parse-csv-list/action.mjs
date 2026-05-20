/**
 * @fileoverview Convert a comma-separated input string to a JSON array suitable
 * for `fromJson()` in a downstream `strategy.matrix`. GitHub Actions expressions
 * have no `split()` builtin, so workflow inputs that need to become matrices
 * have to round-trip through a Node action like this one.
 * @module @cldmv/.github.common.utilities.parse-csv-list
 */

import { getInput, getBooleanInput, setOutput } from "../../common/core.mjs";

try {
	const csv = getInput("csv", { required: true });
	const dropEmpty = getBooleanInput("drop_empty", true);

	let items = csv.split(",").map((s) => s.trim());
	if (dropEmpty) items = items.filter(Boolean);

	const json = JSON.stringify(items);
	console.log(`📋 Parsed ${items.length} item(s): ${json}`);

	setOutput("json", json);
	setOutput("count", String(items.length));
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
