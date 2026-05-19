/**
 * @fileoverview Compute the raw PR label aliases from the version bump type.
 * Node delegation step of the create-release-pr action.
 * @module @cldmv/.github.github.jobs.create-release-pr.raw-labels
 */

import { setOutput } from "../../../common/common/core.mjs";

const bumpType = process.env.BUMP_TYPE || "";
let aliases = `release,${bumpType}`;
if (bumpType === "patch") aliases += ",bug";

setOutput("labels", aliases);
