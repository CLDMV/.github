/**
 * @fileoverview Choose the container-registry login identity — the GitHub App
 * bot when a token is available, otherwise the workflow token. Node entrypoint
 * for the resolve-auth action.
 * @module @cldmv/.github.docker.steps.resolve-auth
 */

import { getBooleanInput, getInput, setOutputs } from "../../../common/common/core.mjs";

const usingAppToken = getBooleanInput("using-app-token");
const appToken = getInput("app-token");

if (usingAppToken && appToken) {
	setOutputs({ username: `${getInput("app-slug")}[bot]`, token: appToken });
	console.log("Using GitHub App bot identity for registry login");
} else {
	setOutputs({ username: getInput("actor"), token: getInput("github-token") });
	console.log("⚠️ Bot token unavailable; falling back to workflow token identity");
}
