/**
 * @fileoverview Compute raw release label aliases from a version bump type
 * (patch releases also get a "bug" alias). Node entrypoint for the
 * compute-label-aliases action.
 * @module @cldmv/.github.github.steps.compute-label-aliases
 */

import { getInput, setOutput } from "../../../common/common/core.mjs";

const bumpType = getInput("bump-type");
let aliases = `release,${bumpType}`;
if (bumpType === "patch") aliases += ",bug";

setOutput("labels", aliases);
