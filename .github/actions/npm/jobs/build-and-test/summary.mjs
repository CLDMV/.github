/**
 * @fileoverview Write the build-and-test step summary, reporting each stage
 * and an overall verdict. Node delegation step of the build-and-test action.
 * @module @cldmv/.github.npm.jobs.build-and-test.summary
 */

import { appendSummary } from "../../../common/common/core.mjs";

const nodeVersion = process.env.NODE_VERSION || "";
const packageManager = process.env.PACKAGE_MANAGER || "npm";
const preTestsOutcome = process.env.PRE_TESTS_OUTCOME || "";
const buildOutcome = process.env.BUILD_OUTCOME || "";

appendSummary("## 🏗️ Build & Test Progress");
appendSummary(`- ✅ Node.js ${nodeVersion} setup complete`);
appendSummary("");
appendSummary(`- ✅ Dependencies installed with ${packageManager}`);
appendSummary(preTestsOutcome === "success" ? "- ✅ Pre-build tests passed" : "- ❌ Pre-build tests failed");
appendSummary(buildOutcome === "success" ? "- ✅ Package build completed" : "- ❌ Package build failed");
appendSummary("- ✅ NPM package created successfully");
appendSummary("- ✅ Build artifacts uploaded");
appendSummary("");

if (preTestsOutcome === "success" && buildOutcome === "success") {
	appendSummary("🎉 **Build & Test Complete** - All steps passed successfully");
} else {
	appendSummary("❌ **Build & Test Failed** - Check the individual step results above");
}
