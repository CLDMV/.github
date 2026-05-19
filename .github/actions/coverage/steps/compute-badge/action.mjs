/**
 * @fileoverview Compute the average coverage percentage from a
 * coverage-summary.json and write a Shields.io-compatible badge.json. Node
 * entrypoint for the compute-badge action.
 * @module @cldmv/.github.coverage.steps.compute-badge
 */

import fs from "node:fs";
import { getInput } from "../../../common/common/core.mjs";

try {
	const summaryPath = getInput("coverage-summary-path", { required: true });
	const total = JSON.parse(fs.readFileSync(summaryPath, "utf8")).total;

	// A metric with zero total counts as fully covered.
	const safePct = (metric) => (metric.total === 0 ? 100 : metric.pct);
	const avg = ((safePct(total.statements) + safePct(total.branches) + safePct(total.functions) + safePct(total.lines)) / 4).toFixed(1);

	const color = avg >= 90 ? "brightgreen" : avg >= 75 ? "green" : avg >= 60 ? "yellow" : "red";

	fs.writeFileSync("badge.json", JSON.stringify({ schemaVersion: 1, label: "coverage", message: `${avg}%`, color }));
	console.log("Coverage avg:", `${avg}%`, "→ color:", color);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
