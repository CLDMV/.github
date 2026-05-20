/**
 * @fileoverview Emit simulated PR outputs for dry-run mode. Node delegation
 * step of the create-release-pr action.
 * @module @cldmv/.github.github.jobs.create-release-pr.dry-outputs
 */

import { setOutputs } from "../../../common/common/core.mjs";

setOutputs({ "pr-created": "true", "pr-number": "DRY-RUN" });
