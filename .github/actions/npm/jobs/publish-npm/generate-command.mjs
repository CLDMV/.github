/**
 * @fileoverview Generate the npm/yarn publish command, honouring a custom
 * command or deriving --access from repository visibility. Node delegation
 * step of the publish-npm action.
 * @module @cldmv/.github.npm.jobs.publish-npm.generate-command
 */

import { getEventPayload, setOutput } from "../../../common/common/core.mjs";

const customCommand = process.env.CUSTOM_CMD || "";
const packageManager = process.env.PACKAGE_MANAGER || "npm";

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
	const tool = packageManager === "yarn" ? "yarn publish" : "npm publish";
	finalCommand = `${tool} --access ${accessLevel}`;
	// Public npm packages published via the npm CLI carry SLSA build provenance
	// + a publish attestation (sigstore). Private packages can't, and `yarn
	// publish` has no equivalent flag — so gate on both. Kept in sync with the
	// authoritative builder in utilities/repo-detection (this fallback runs only
	// when no command was pre-derived).
	if (visibility === "public" && tool === "npm publish") {
		finalCommand += " --provenance";
	}
}

console.log(`📝 Final publish command: ${finalCommand}`);
setOutput("command", finalCommand);
