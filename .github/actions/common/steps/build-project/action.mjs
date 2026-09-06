/**
 * @fileoverview Build the project with a configurable command and environment,
 * writing progress to the GitHub step summary. Node entrypoint for the
 * build-project action.
 *
 * The build command's leading `npm` / `npx` token is routed through the
 * repository's resolved package manager, so a pnpm/yarn repo runs `pnpm run …`
 * without every caller having to override the command. A no-op for npm repos.
 * @module @cldmv/.github.common.steps.build-project
 */

import { getInput, exec, appendSummary } from "../../../common/common/core.mjs";
import { resolvePackageManager, pmCommand } from "../../../npm/utilities/detect-package-manager/resolve.mjs";

const pm = resolvePackageManager(getInput("package-manager", { default: "auto" }), ".");
const buildCommand = pmCommand(pm, getInput("build-command", { required: true }));
const environment = getInput("environment", { default: "production" });

appendSummary(`🏗️ **Building project** (\`${buildCommand}\`)`);
appendSummary(`- Environment: \`${environment}\``);
appendSummary(`- Started: ${new Date().toString()}`);
appendSummary("");

try {
	// Provision pnpm/yarn via corepack (bundled with Node — no third-party action).
	if (pm !== "npm") {
		try {
			exec("corepack enable");
		} catch {
			// Best-effort; assume pnpm/yarn is already on PATH.
		}
	}
	exec(buildCommand, { NODE_ENV: environment });
	appendSummary("✅ **Build completed successfully**");
	appendSummary(`- Finished: ${new Date().toString()}`);
	appendSummary("");
} catch {
	appendSummary("❌ **Build failed**");
	appendSummary(`- Command: \`${buildCommand}\``);
	appendSummary(`- Environment: \`${environment}\``);
	appendSummary(`- Failed at: ${new Date().toString()}`);
	appendSummary("");
	console.error(`::error::Build failed: ${buildCommand}`);
	process.exit(1);
}
