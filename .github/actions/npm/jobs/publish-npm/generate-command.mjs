/**
 * @fileoverview Generate the npm/yarn publish command, honouring a custom
 * command or deriving --access from repository visibility. Node delegation
 * step of the publish-npm action.
 * @module @cldmv/.github.npm.jobs.publish-npm.generate-command
 */

import { getEventPayload, setOutput } from "../../../common/common/core.mjs";
import { resolvePackageManager } from "../../utilities/detect-package-manager/resolve.mjs";
import { buildPublishCommand } from "../../utilities/publish-command/build.mjs";

const customCommand = process.env.CUSTOM_CMD || "";
const packageManager = resolvePackageManager(process.env.PACKAGE_MANAGER || "auto", ".");

let finalCommand;
if (customCommand) {
	console.log("🔧 Using custom publish command");
	finalCommand = customCommand;
} else {
	console.log("🔧 Generating publish command based on repository and package settings");
	// A repository is "public" only when `private` is explicitly false.
	const isPrivate = getEventPayload().repository?.private;
	const visibility = isPrivate === false ? "public" : "private";
	console.log(`📊 Repository visibility: ${visibility}`);
	const accessLevel = visibility === "public" ? "public" : "restricted";
	console.log(`🔒 Package access level: ${accessLevel}`);
	// Shared with the authoritative builder in utilities/repo-detection (this
	// fallback runs only when no command was pre-derived): --ignore-scripts
	// always, --provenance for public npm-CLI publishes.
	finalCommand = buildPublishCommand({ packageManager, isPrivate: visibility !== "public", registry: "npm" });
}

console.log(`📝 Final publish command: ${finalCommand}`);
setOutput("command", finalCommand);
