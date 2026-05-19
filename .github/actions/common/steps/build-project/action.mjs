/**
 * @fileoverview Build the project with a configurable command and environment,
 * writing progress to the GitHub step summary. Node entrypoint for the
 * build-project action.
 * @module @cldmv/.github.common.steps.build-project
 */

import { getInput, exec, appendSummary } from "../../common/common/core.mjs";

const buildCommand = getInput("build-command", { required: true });
const environment = getInput("environment", { default: "production" });

appendSummary(`🏗️ **Building project** (\`${buildCommand}\`)`);
appendSummary(`- Environment: \`${environment}\``);
appendSummary(`- Started: ${new Date().toString()}`);
appendSummary("");

try {
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
