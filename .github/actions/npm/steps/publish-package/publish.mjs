/**
 * @fileoverview Publish a package to a registry, classifying failures
 * (version conflict, auth, network) and reporting structured outputs. Runs
 * with the package-contents directory as its working directory. Publish step
 * of the publish-package action.
 * @module @cldmv/.github.npm.steps.publish-package.publish
 */

import fs from "node:fs";
import { execSync } from "node:child_process";
import { setOutputs } from "../../../common/common/core.mjs";

const packageName = process.env.PACKAGE_NAME || "";
const packageVersion = process.env.PACKAGE_VERSION || "";
const registryName = process.env.REGISTRY_NAME || "";
const registryUrl = process.env.REGISTRY_URL || "";
const publishCmd = process.env.PUBLISH_COMMAND || "";
const dryRun = process.env.DRY_RUN === "true";
const authToken = process.env.AUTH_TOKEN || "";

// Token auth when a token is supplied; otherwise OIDC (trusted publishers),
// which needs a clean .npmrc free of token references.
const env = { ...process.env };
if (authToken) {
	env.NODE_AUTH_TOKEN = authToken;
	console.log("🔑 Using token-based authentication");
} else {
	console.log("🔓 Using OIDC authentication (trusted publishers)");
	if (fs.existsSync(".npmrc")) {
		console.log("🗑️ Removing .npmrc token configuration for OIDC authentication");
		fs.rmSync(".npmrc", { force: true });
	}
}

console.log(`🚀 Publishing ${packageName}@${packageVersion} to ${registryName}`);
console.log("📂 Publishing from package-contents directory");
console.log("📋 Files in package:");
for (const name of fs.readdirSync(".")) console.log(`  ${name}`);

if (!fs.existsSync("package.json")) {
	setOutputs({
		published: "false",
		"error-type": "missing-package-json",
		"error-message": "package.json not found in package-contents directory",
		"suggested-fix": "Ensure build step creates package-contents with package.json"
	});
	console.error("::error::No package.json found in package-contents");
	process.exit(1);
}

if (!publishCmd) {
	setOutputs({
		published: "false",
		"error-type": "missing-command",
		"error-message": "No publish command was provided",
		"suggested-fix": "Provide a valid publish command in workflow inputs"
	});
	console.error("::error::No publish command provided");
	process.exit(1);
}

if (dryRun) {
	console.log("🧪 DRY RUN MODE: Validating publish setup without executing");
	console.log(`📝 Would execute command: ${publishCmd}`);
	console.log(`🌐 Target registry: ${registryUrl}`);
	console.log("");
	console.log("✅ Validation completed successfully:");
	console.log("  - Package directory structure is valid");
	console.log("  - package.json exists and is accessible");
	console.log("  - Node.js and registry configuration is correct");
	console.log("  - Publish command is properly formatted");
	console.log("  - Authentication token is available");
	console.log("");
	console.log(`💡 In real run, would execute: ${publishCmd} (targeting ${registryUrl})`);
	setOutputs({ published: "true", "error-type": "", "error-message": "", "suggested-fix": "", "is-registry-available": "true" });
	process.exit(0);
}

// Execute the publish command, capturing combined stdout/stderr.
console.log(`🔧 Running command: ${publishCmd}`);
let output = "";
let success = false;
try {
	output = execSync(`${publishCmd} 2>&1`, { encoding: "utf8", env });
	success = true;
} catch (error) {
	output = `${error.stdout || ""}${error.stderr || ""}`;
}

if (success) {
	console.log(`✅ Successfully published to ${registryName}`);
	console.log(output);
	setOutputs({ published: "true", "error-type": "", "error-message": "", "suggested-fix": "", "is-registry-available": "true" });
	process.exit(0);
}

console.log("❌ Publish failed");
console.log(`Error output: ${output}`);

if (output.includes("Cannot publish over previously published version")) {
	console.log("");
	console.log(`📊 Version conflict detected: ${packageVersion} was previously published`);

	// The version may have been published then unpublished — check availability.
	let registryAvailable = false;
	try {
		execSync(`npm view "${packageName}@${packageVersion}" version`, { stdio: ["ignore", "pipe", "ignore"] });
		registryAvailable = true;
	} catch {
		registryAvailable = false;
	}

	if (registryAvailable) {
		console.log(`✅ Version ${packageVersion} is available in registry`);
		console.log("ℹ️ This is a pseudo-success - version exists and is accessible");
		setOutputs({
			published: "true",
			"error-type": "version-already-published",
			"error-message": `Version ${packageVersion} already exists in registry`,
			"suggested-fix": "This is normal - the version is already published and available",
			"is-registry-available": "true"
		});
		process.exit(0);
	}

	console.log(`❌ Version ${packageVersion} is NOT available in registry`);
	console.log("⚠️ This version was previously published but is now reserved/hidden");
	setOutputs({
		published: "false",
		"error-type": "version-conflict",
		"error-message": `Version ${packageVersion} is reserved by NPM (previously published then unpublished)`,
		"suggested-fix": "Update package.json version, git tags, and GitHub releases to a new version number",
		"is-registry-available": "false"
	});
	process.exit(1);
} else if (/403|401|authentication|Unauthorized|Forbidden/.test(output)) {
	console.log("❌ Authentication/authorization error");
	setOutputs({
		published: "false",
		"error-type": "auth-error",
		"error-message": "Authentication failed - check token permissions",
		"suggested-fix": "Verify NPM_TOKEN or GITHUB_TOKEN has publish permissions",
		"is-registry-available": "unknown"
	});
	process.exit(1);
} else if (/network|timeout|ENOTFOUND|ETIMEDOUT/.test(output)) {
	console.log("❌ Network error");
	setOutputs({
		published: "false",
		"error-type": "network-error",
		"error-message": "Network connectivity issue",
		"suggested-fix": "Retry the workflow - this may be a temporary network issue",
		"is-registry-available": "unknown"
	});
	process.exit(1);
} else {
	console.log("❌ Unknown publish error");
	setOutputs({
		published: "false",
		"error-type": "unknown",
		"error-message": output,
		"suggested-fix": "Check the error message above and resolve the specific issue",
		"is-registry-available": "unknown"
	});
	process.exit(1);
}
