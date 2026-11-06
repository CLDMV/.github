#!/usr/bin/env node
/**
 * @fileoverview Unit tests for enableCorepack. Run: `node enable.test.mjs`.
 */

import { enableCorepack } from "./enable.mjs";

let failures = 0;
function eq(actual, expected, label) {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		console.log(`  ✅ ${label}`);
	} else {
		console.error(`  ❌ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
		failures++;
	}
}

function harness({ has, fail = [] }) {
	const ran = [];
	const logs = [];
	const result = enableCorepack({
		has: () => has,
		run: (cmd) => {
			ran.push(cmd);
			if (fail.includes(cmd)) throw new Error(`${cmd} failed`);
		},
		log: (line) => logs.push(line)
	});
	return { result, ran, logs };
}

console.log("enableCorepack:");
{
	const { result, ran } = harness({ has: true });
	eq(ran, ["corepack enable"], "corepack present: only enables");
	eq(result, true, "corepack present: returns true");
}
{
	const { result, ran } = harness({ has: false });
	eq(ran, ["npm install -g corepack", "corepack enable"], "corepack missing (Node 25+): installs, then enables");
	eq(result, true, "corepack missing: returns true once enabled");
}
{
	const { result, ran, logs } = harness({ has: false, fail: ["npm install -g corepack"] });
	eq(ran, ["npm install -g corepack"], "install fails: doesn't try to enable");
	eq(result, false, "install fails: returns false");
	eq(
		logs.some((l) => l.startsWith("::warning::Installing corepack failed")),
		true,
		"install fails: warns"
	);
}
{
	const { result, logs } = harness({ has: true, fail: ["corepack enable"] });
	eq(result, false, "enable fails: returns false");
	eq(
		logs.some((l) => l.startsWith("::warning::corepack enable failed")),
		true,
		"enable fails: warns"
	);
}

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log("\nAll enableCorepack tests passed.");
