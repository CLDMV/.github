/**
 * @fileoverview Unit tests for the default publish-command builder.
 * Run: `node test.mjs`. Exits non-zero on failure.
 * @module @cldmv/.github.npm.utilities.publish-command.test
 */

import { buildPublishCommand } from "./build.mjs";

let failures = 0;
function eq(name, got, want) {
	if (got === want) {
		console.log(`  ✅ ${name}`);
	} else {
		failures++;
		console.log(`  ❌ ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
	}
}

console.log("buildPublishCommand — npm registry:");
eq(
	"npm, public → public access, ignore-scripts, provenance",
	buildPublishCommand({ packageManager: "npm", isPrivate: false, registry: "npm" }),
	"npm publish --access public --ignore-scripts --provenance"
);
eq(
	"npm, private → restricted, ignore-scripts, no provenance",
	buildPublishCommand({ packageManager: "npm", isPrivate: true, registry: "npm" }),
	"npm publish --access restricted --ignore-scripts"
);
eq(
	"pnpm, public → no provenance",
	buildPublishCommand({ packageManager: "pnpm", isPrivate: false, registry: "npm" }),
	"pnpm publish --access public --ignore-scripts"
);
eq(
	"yarn, public → no provenance",
	buildPublishCommand({ packageManager: "yarn", isPrivate: false, registry: "npm" }),
	"yarn publish --access public --ignore-scripts"
);

console.log("buildPublishCommand — GitHub Packages:");
eq(
	"npm, public → no provenance on GitHub Packages",
	buildPublishCommand({ packageManager: "npm", isPrivate: false, registry: "github-packages" }),
	"npm publish --access public --ignore-scripts"
);
eq(
	"npm, private → restricted",
	buildPublishCommand({ packageManager: "npm", isPrivate: true, registry: "github-packages" }),
	"npm publish --access restricted --ignore-scripts"
);
eq(
	"pnpm, private → restricted",
	buildPublishCommand({ packageManager: "pnpm", isPrivate: true, registry: "github-packages" }),
	"pnpm publish --access restricted --ignore-scripts"
);

if (failures) {
	console.log(`\n❌ ${failures} failure(s)`);
	process.exit(1);
}
console.log("\n✅ all passed");
