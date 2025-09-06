import fs from "node:fs";
import { run as runCheck } from "../check/_impl.mjs";
import { run as runCreate } from "../create/_impl.mjs";
import { run as runUpdate } from "../update/_impl.mjs";
import { run } from "./_impl.mjs"; // orchestrator

try {
	const token = process.env.GITHUB_TOKEN;
	const repo = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
	const raw = process.env.INPUT_PAYLOAD;

	if (!token) throw new Error("GITHUB_TOKEN is required");
	const res = await run({ token, repo, raw, runCheck, runCreate, runUpdate });
	if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, res.summary);
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `report=${JSON.stringify(res.report)}\n`);
} catch (e) {
	console.error(`::error::${e.message}`);
	process.exit(1);
}
