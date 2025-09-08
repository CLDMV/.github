#!/usr/bin/env node

import { execSync } from "child_process";

function getTagInfo(tagName) {
	try {
		const tagInfo = execSync(`git cat-file -p ${tagName}`, { encoding: "utf8" });
		console.log(`Raw tag info for ${tagName}:`);
		console.log("=".repeat(50));
		console.log(tagInfo);
		console.log("=".repeat(50));

		const taggerMatch = tagInfo.match(/^tagger (.+) (\d+) ([\+\-]\d{4})$/m);
		if (taggerMatch) {
			const [, nameEmail, timestamp, timezone] = taggerMatch;
			const emailMatch = nameEmail.match(/^(.+) <(.+)>$/);
			const name = emailMatch ? emailMatch[1] : nameEmail;
			const email = emailMatch ? emailMatch[2] : "";

			const messageMatch = tagInfo.match(/\n\n([\s\S]*?)(?:\n-----BEGIN PGP SIGNATURE-----[\s\S]*)?$/);
			const message = messageMatch ? messageMatch[1].trim() : `Update ${tagName}`;

			return {
				type: "annotated",
				tagger: { name, email },
				timestamp: parseInt(timestamp),
				timezone,
				message
			};
		}

		return null;
	} catch (error) {
		console.error(`Error getting tag info for ${tagName}:`, error.message);
		return null;
	}
}

// Test with v1 (signed tag)
const tagInfo = getTagInfo("v1");
console.log("\nExtracted tag info:");
console.log(JSON.stringify(tagInfo, null, 2));
