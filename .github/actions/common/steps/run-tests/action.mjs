/**
 * @fileoverview Run the project test suite with a configurable command and
 * environment. If the command already carries NODE_ENV / NODE_OPTIONS it runs
 * as-is; otherwise sensible defaults are applied. Node entrypoint for the
 * run-tests action.
 * @module @cldmv/.github.common.steps.run-tests
 */

import { getInput, exec } from "../../../common/common/core.mjs";
import { resolvePackageManager, pmCommand } from "../../../npm/utilities/detect-package-manager/resolve.mjs";

try {
	const pm = resolvePackageManager(getInput("package-manager", { default: "auto" }), ".");
	const testCommand = pmCommand(pm, getInput("test-command", { required: true }));
	const environment = getInput("environment", { default: "development" });

	// Provision pnpm/yarn via corepack (bundled with Node — no third-party action).
	if (pm !== "npm") {
		try {
			exec("corepack enable");
		} catch {
			// Best-effort; assume pnpm/yarn is already on PATH.
		}
	}

	console.log(`🔍 DEBUG: test-command input = '${testCommand}'`);
	console.log(`🔍 DEBUG: environment input = '${environment}'`);

	const hasNodeEnv = testCommand.includes("NODE_ENV=");
	const hasNodeOptions = testCommand.includes("NODE_OPTIONS=");
	console.log(`🔍 DEBUG: HAS_NODE_ENV = ${hasNodeEnv}`);
	console.log(`🔍 DEBUG: HAS_NODE_OPTIONS = ${hasNodeOptions}`);

	if (hasNodeEnv || hasNodeOptions) {
		// The command provides its own env vars — run it untouched.
		console.log("🔍 DEBUG: Using command as-is (user provided env vars)");
		exec(testCommand);
	} else {
		// No NODE_* vars in the command — apply our defaults.
		console.log(`🔍 DEBUG: Setting environment variables - NODE_ENV='${environment}' NODE_OPTIONS='--conditions=${environment}'`);
		console.log(`🔍 DEBUG: About to run: ${testCommand}`);
		exec(testCommand, { NODE_ENV: environment, NODE_OPTIONS: `--conditions=${environment}` });
	}
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
