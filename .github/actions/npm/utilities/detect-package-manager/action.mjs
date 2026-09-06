/**
 * @fileoverview Resolve the repository's package manager and expose it as an
 * action output for YAML consumers (e.g. `actions/setup-node`'s `cache:` and
 * run-block command routing). Node entrypoint for the detect-package-manager
 * action.
 * @module @cldmv/.github.npm.utilities.detect-package-manager
 */

import { getInput, setOutput } from "../../../common/common/core.mjs";
import { resolvePackageManager, hasLockfile } from "./resolve.mjs";

try {
	const requested = getInput("package-manager", { default: "auto" });
	const pm = resolvePackageManager(requested, ".");
	console.log(`📦 Resolved package manager: ${pm} (requested: "${requested}")`);
	setOutput("package-manager", pm);

	// `cache` feeds actions/setup-node's `cache:` input directly. setup-node
	// errors when `cache` is set but no matching lockfile exists, and its pnpm
	// cache path needs pnpm on PATH before setup-node runs (an ordering the
	// corepack-only constraint can't guarantee) — so cache only npm/yarn, only
	// when their lockfile is present, and leave it empty otherwise (setup-node
	// then simply skips caching instead of failing).
	const cache = pm !== "pnpm" && hasLockfile(pm, ".") ? pm : "";
	setOutput("cache", cache);
	console.log(`📦 setup-node cache: ${cache || "(disabled)"}`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
