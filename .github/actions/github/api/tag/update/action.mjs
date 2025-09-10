import fs from "node:fs";
import { run } from "./_impl.mjs";

try {
	const token = process.env.GITHUB_TOKEN;

	const gpg_enabled = (process.env.INPUT_GPG_ENABLED || "false").toLowerCase() === "true";
	const tagger_name = process.env.INPUT_TAGGER_NAME || process.env.CLDMV_BOT_NAME || process.env.GITHUB_ACTOR;
	const tagger_email = process.env.INPUT_TAGGER_EMAIL || process.env.CLDMV_BOT_EMAIL || "";
	const gpg_private_key = process.env.INPUT_GPG_PRIVATE_KEY || process.env.CLDMV_BOT_GPG_PRIVATE_KEY || process.env.GPG_PRIVATE_KEY || "";
	const gpg_passphrase = process.env.INPUT_GPG_PASSPHRASE || process.env.CLDMV_BOT_GPG_PASSPHRASE || process.env.GPG_PASSPHRASE || "";
	const push = String(process.env.INPUT_PUSH || "true").toLowerCase() !== "false";

	const repo = process.env.INPUT_REPO || process.env.GITHUB_REPOSITORY;
	const tag = process.env.INPUT_TAG;
	const sha = process.env.INPUT_SHA;
	const message = process.env.INPUT_MESSAGE || tag;

	if (!token) throw new Error("GITHUB_TOKEN is required");
	const res = await run({ token, repo, tag, sha, message, gpg_enabled, tagger_name, tagger_email, gpg_private_key, gpg_passphrase, push });
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
