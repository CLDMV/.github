import fs from "node:fs";
import { run } from "./_impl.mjs";

try {
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
	const debug = String(process.env.INPUT_DEBUG || "false").toLowerCase() === "true";

	// Release inputs
	const tag_name = process.env.INPUT_TAG_NAME;
	const name = process.env.INPUT_NAME;
	const body = process.env.INPUT_BODY || "";
	const is_prerelease = String(process.env.INPUT_IS_PRERELEASE || "false").toLowerCase() === "true";
	const is_draft = String(process.env.INPUT_IS_DRAFT || "false").toLowerCase() === "true";
	const assets = process.env.INPUT_ASSETS || "";

	if (!token) throw new Error("GITHUB_TOKEN is required");
	if (!tag_name) throw new Error("tag_name is required");
	if (!name) throw new Error("name is required");

	const res = await run({
		token,
		repo,
		tag_name,
		name,
		body,
		is_prerelease,
		is_draft,
		assets,
		debug
	});

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
