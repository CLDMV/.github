/**
 * @fileoverview Decide whether GPG signing is enabled — true only when signing
 * was requested and a private key is available. Node entrypoint for the
 * detect-gpg action.
 * @module @cldmv/.github.git.steps.detect-gpg
 */

import { getBooleanInput, setOutput } from "../../../common/common/core.mjs";

const useGpg = getBooleanInput("use-gpg");
const hasGpgKey = getBooleanInput("has-gpg-key");

if (useGpg && hasGpgKey) {
	setOutput("gpg-enabled", "true");
	console.log("✅ GPG signing enabled (use_gpg=true, GPG_PRIVATE_KEY available)");
} else {
	setOutput("gpg-enabled", "false");
	console.log(useGpg ? "⚠️ GPG signing disabled (GPG_PRIVATE_KEY not available)" : "🔒 GPG signing disabled (use_gpg=false)");
}
