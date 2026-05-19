/**
 * @fileoverview Render the Docker publish job summary. Node entrypoint for the
 * docker publish-summary action.
 * @module @cldmv/.github.docker.steps.publish-summary
 */

import { getInput, appendSummary } from "../../../common/common/core.mjs";

appendSummary("## 🐳 Docker Publish Summary");
appendSummary("");
appendSummary(`- **Image**: ${getInput("image")}`);
appendSummary(`- **Digest**: ${getInput("digest")}`);
appendSummary(`- **Registry User**: ${getInput("registry-user")}`);
appendSummary(`- **Pre-publish Command**: ${getInput("pre-publish-command") || "none"}`);
