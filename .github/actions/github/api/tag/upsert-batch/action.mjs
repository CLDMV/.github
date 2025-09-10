import fs from "node:fs";
import { run as runCheck } from "../check/_impl.mjs";
import { run as runCreate } from "../create/_impl.mjs";
import { run as runUpdate } from "../update/_impl.mjs";
import { run } from "./_impl.mjs"; // orchestrator

try {
	const token = process.env.GITHUB_TOKEN;

	const gpg_enabled = (process.env.INPUT_GPG_ENABLED || "false").toLowerCase() === "true";
	const tagger_name = process.env.INPUT_TAGGER_NAME || process.env.CLDMV_BOT_NAME || process.env.GITHUB_ACTOR;
	const tagger_email = process.env.INPUT_TAGGER_EMAIL || process.env.CLDMV_BOT_EMAIL || "";
	const gpg_private_key = process.env.INPUT_GPG_PRIVATE_KEY || process.env.CLDMV_BOT_GPG_PRIVATE_KEY || process.env.GPG_PRIVATE_KEY || "";
	const gpg_passphrase = process.env.INPUT_GPG_PASSPHRASE || process.env.CLDMV_BOT_GPG_PASSPHRASE || process.env.GPG_PASSPHRASE || "";
	const push = String(process.env.INPUT_PUSH || "true").toLowerCase() !== "false";

	const repo = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
	const raw = process.env.INPUT_PAYLOAD;

	if (!token) throw new Error("GITHUB_TOKEN is required");
	const res = await run({
		token,
		repo,
		raw,
		runCheck,
		runCreate,
		runUpdate,
		gpg_enabled,
		tagger_name,
		tagger_email,
		gpg_private_key,
		gpg_passphrase,
		push
	});
	// if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, res.summary);
	fs.appendFileSync(process.env.GITHUB_OUTPUT, `report=${JSON.stringify(res.report)}\n`);
} catch (e) {
	console.error(`::error::${e.message}`);
	process.exit(1);
}
