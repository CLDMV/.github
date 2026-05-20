/**
 * @fileoverview Build the summary JSON describing a major/minor version tag
 * update. Node entrypoint for the generate-tag-update-summary action.
 * @module @cldmv/.github.git.steps.generate-tag-update-summary
 */

import { getBooleanInput, getInput, setOutput } from "../../../common/common/core.mjs";

const updated = getBooleanInput("updated");
const majorVersion = getInput("major-version");
const minorVersion = getInput("minor-version");
const sourceTag = getInput("source-tag");

const summary = {
	title: "🔧 Update Major/Minor Version Tags",
	description: "Updates major and minor version tags to point to the latest semantic version.",
	lines: updated
		? [
				`- ✅ **Updated major tag**: \`${majorVersion}\` → \`${sourceTag}\``,
				`- ✅ **Updated minor tag**: \`${minorVersion}\` → \`${sourceTag}\``,
				`- 📋 **Source tag**: \`${sourceTag}\``
			]
		: ["- ℹ️ **No updates needed**: Version tags are already current"],
	stats_template: "🏷️ Major/Minor Updates: {count}",
	notes: updated
		? [`Version tags \`${majorVersion}\` and \`${minorVersion}\` now point to \`${sourceTag}\``]
		: ["All version tags are already pointing to the correct targets"],
	fixed_count: updated ? 1 : 0,
	updated,
	major_version: majorVersion,
	minor_version: minorVersion,
	source_tag: sourceTag,
	tags: updated
		? [
				{ tag: majorVersion, target: sourceTag },
				{ tag: minorVersion, target: sourceTag }
			]
		: []
};

console.log("🔍 DEBUG: Major/Minor update summary data:");
console.log(JSON.stringify(summary, null, 2));
setOutput("summary-json", JSON.stringify(summary));
