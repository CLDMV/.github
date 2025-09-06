import fs from "node:fs";
import { run } from "./_impl.mjs";

try {
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
	const tag = process.env.INPUT_TAG;

	if (!token) throw new Error("GITHUB_TOKEN is required");
	const res = await run({ token, repo, tag });
	fs.appendFileSync(
		process.env.GITHUB_OUTPUT,
		Object.entries(res)
			.map(([k, v]) => `${k}=${v}`)
			.join("\n") + "\n"
	);
} catch (e) {
	console.error(`::error::${e.message}`);
	process.exit(1);
}
