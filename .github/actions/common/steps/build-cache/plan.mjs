/**
 * @fileoverview Entry point for the build-cache action's plan step: reads the
 * inputs from env, computes the cache key and the save decision, and writes
 * them as step outputs. See build-cache.mjs for the key layout.
 * @module @cldmv/.github.common.steps.build-cache.plan
 */

import { getEventPayload, setOutputs } from "../../../common/common/core.mjs";
import { plan } from "./build-cache.mjs";

try {
	const result = plan({
		root: process.cwd(),
		paths: process.env.BUILD_CACHE_PATHS,
		keyFiles: process.env.BUILD_CACHE_KEY_FILES,
		buildCommand: process.env.BUILD_COMMAND,
		os: process.env.RUNNER_OS,
		arch: process.env.RUNNER_ARCH,
		eventName: process.env.GITHUB_EVENT_NAME,
		ref: process.env.GITHUB_REF,
		defaultBranch: getEventPayload().repository?.default_branch || ""
	});

	if (!result.enabled) {
		console.log("ℹ️ No build cache paths set; the build cache is off.");
	} else {
		console.log(`📦 Cached paths:\n${result.paths.map((p) => `  ${p}`).join("\n")}`);
		console.log(`🔑 Key files (${result.files.length}):`);
		for (const rel of result.files) console.log(`  ${rel}`);
		if (result.files.length === 0) {
			console.log(
				"::warning title=Build cache::No files matched build_cache_key_files, so the key only changes with the build command and the cached paths. Set build_cache_key_files to the inputs of the cached output."
			);
		}
		console.log(`🔑 Key: ${result.key}`);
		console.log(
			result.save
				? "💾 This run saves the cache on a miss."
				: "👀 Restore only (saves happen on pushes to the default branch, next and hotfixes)."
		);
	}

	setOutputs({ enabled: String(result.enabled), key: result.key, "save-eligible": String(result.save) });
} catch (error) {
	// The cache only saves time; a planning failure turns it off for this run
	// instead of failing the build it sits around.
	const message = String(error.message)
		.replace(/%/g, "%25")
		.replace(/\s*[\r\n]+\s*/g, " ");
	console.log(`::warning title=Build cache::Build cache disabled for this run: ${message}`);
	setOutputs({ enabled: "false", key: "", "save-eligible": "false" });
}
