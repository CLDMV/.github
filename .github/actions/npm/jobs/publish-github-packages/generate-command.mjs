/**
 * @fileoverview Generate the npm/yarn publish command for GitHub Packages,
 * honouring a custom command or deriving --access from repository visibility.
 * Node delegation step of the publish-github-packages action.
 * @module @cldmv/.github.npm.jobs.publish-github-packages.generate-command
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
	console.log("🔧 Generating GitHub Packages publish command");
	// GitHub Packages access should match repo visibility; "public" only when
	// `private` is explicitly false.
	const isPrivate = getEventPayload().repository?.private;
	const visibility = isPrivate === false ? "public" : "private";
	console.log(`📊 Repository visibility: ${visibility}`);
	const accessLevel = visibility === "public" ? "public" : "restricted";
	console.log(`🔒 Package access level: ${accessLevel}`);
	// Shared with the authoritative builder in utilities/repo-detection
	// (--ignore-scripts always; no provenance on GitHub Packages).
	finalCommand = buildPublishCommand({ packageManager, isPrivate: visibility !== "public", registry: "github-packages" });
}

console.log(`📝 Final publish command: ${finalCommand}`);
setOutput("command", finalCommand);
