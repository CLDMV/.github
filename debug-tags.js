/**
 * Debug script to examine Git tag structure and test regex matching
 * This helps identify why the taggerMatch regex fails for signed annotated tags
 */

const { execSync } = require("child_process");

// The regex from fix-non-bot-tags action that's failing
const taggerRegex = /^tagger (.+) (\d{10,}) ([\+\-]\d{4})$/m;

function debugTag(tagName) {
	console.log(`\n=== Debugging Tag: ${tagName} ===`);

	try {
		// Get the tag object
		const tagObject = execSync(`git cat-file -p ${tagName}`, { encoding: "utf8" });
		console.log("\n--- Raw tag object ---");
		console.log(tagObject);
		console.log("--- End raw tag object ---");

		// Test the regex
		const taggerMatch = tagObject.match(taggerRegex);
		console.log(`\nTagger regex match result:`, taggerMatch);

		if (taggerMatch) {
			console.log(`✅ FOUND TAGGER: ${taggerMatch[1]} at ${taggerMatch[2]} ${taggerMatch[3]}`);
		} else {
			console.log(`❌ NO TAGGER MATCH - This tag will be treated as lightweight`);
		}

		// Check if it's actually an annotated tag by looking for "tag " prefix
		const isAnnotated = tagObject.startsWith("tag ");
		console.log(`Is annotated tag: ${isAnnotated}`);

		// Extract the message if it's annotated
		if (isAnnotated) {
			const messagePart = tagObject.split("\n\n").slice(1).join("\n\n").trim();
			console.log(`\nExtracted message:`);
			console.log(`"${messagePart}"`);
		}

		// Show what commit it points to
		const commit = execSync(`git rev-list -n 1 ${tagName}`, { encoding: "utf8" }).trim();
		console.log(`\nPoints to commit: ${commit}`);

		// Show the commit message for comparison
		const commitMessage = execSync(`git log -1 --pretty=format:"%s" ${commit}`, { encoding: "utf8" });
		console.log(`Commit message: "${commitMessage}"`);
	} catch (error) {
		console.error(`Error examining ${tagName}:`, error.message);
	}
}

// Test with a few different tags to see the pattern
const tagsToTest = ["v1", "v1.0", "v1.3", "v1.3.29"];

for (const tag of tagsToTest) {
	debugTag(tag);
}

// Also let's see all the different tag structures we have
console.log("\n=== Tag Type Summary ===");
try {
	const allTags = execSync("git tag -l", { encoding: "utf8" }).trim().split("\n");

	for (const tag of allTags) {
		try {
			const tagObject = execSync(`git cat-file -p ${tag}`, { encoding: "utf8" });
			const isAnnotated = tagObject.startsWith("tag ");
			const hasTagger = taggerRegex.test(tagObject);
			console.log(`${tag.padEnd(8)} - Annotated: ${isAnnotated ? "✅" : "❌"} - Tagger Match: ${hasTagger ? "✅" : "❌"}`);
		} catch (e) {
			console.log(`${tag.padEnd(8)} - ERROR: ${e.message}`);
		}
	}
} catch (error) {
	console.error("Error listing tags:", error.message);
}
