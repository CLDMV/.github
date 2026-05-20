/**
 * @fileoverview Generate the npm/yarn publish command for GitHub Packages,
 * honouring a custom command or deriving --access from repository visibility.
 * Node delegation step of the publish-github-packages action.
 * @module @cldmv/.github.npm.jobs.publish-github-packages.generate-command
 */

import { getEventPayload, setOutput } from "../../../common/common/core.mjs";

const customCommand = process.env.CUSTOM_CMD || "";
const packageManager = process.env.PACKAGE_MANAGER || "npm";

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
	const tool = packageManager === "yarn" ? "yarn publish" : "npm publish";
	finalCommand = `${tool} --access ${accessLevel}`;
}

console.log(`📝 Final publish command: ${finalCommand}`);
setOutput("command", finalCommand);
