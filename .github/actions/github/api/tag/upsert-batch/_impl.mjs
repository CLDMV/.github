import { debugLog } from "../../../../common/common/core.mjs";

export async function run({
	token,
	repo,
	raw,
	runCheck,
	runCreate,
	runUpdate,
	gpg_enabled = false,
	tagger_name = "",
	tagger_email = "",
	gpg_private_key = "",
	gpg_passphrase = "",
	push = true
}) {
	if (!raw) throw new Error("payload is required");

	let items;
	try {
		items = JSON.parse(raw);
	} catch {
		throw new Error("payload must be valid JSON");
	}
	if (!Array.isArray(items)) throw new Error("payload must be an array");

	const rows = [];
	const results = [];

	for (const it of items) {
		const tag = String(it.tag || "");
		const sha = String(it.sha || "");
		const message = String(it.message || tag);
		debugLog(`upsert-batch: Processing item: ${JSON.stringify(it)}`);
		debugLog(`upsert-batch: tag="${tag}", sha="${sha}", message="${message}"`);
		if (!tag) throw new Error(`Missing tag in item: ${JSON.stringify(it)}`);
		if (!sha) throw new Error(`Missing sha in item: ${JSON.stringify(it)}`);

		const chk = await runCheck({ token, repo, tag });
		debugLog(`upsert-batch: Tag ${tag} exists: ${chk.exists}`);
		if (chk.exists === "true") {
			debugLog(`upsert-batch: Calling runUpdate with message: "${message}"`);
			const out = await runUpdate({
				token,
				repo,
				tag,
				sha,
				message,
				gpg_enabled,
				tagger_name,
				tagger_email,
				gpg_private_key,
				gpg_passphrase,
				push
			});
			results.push({ tag, action: "update", tag_obj_sha: out.tag_obj_sha });
		} else {
			debugLog(`upsert-batch: Calling runCreate with message: "${message}"`);
			const out = await runCreate({
				token,
				repo,
				tag,
				sha,
				message,
				gpg_enabled,
				tagger_name,
				tagger_email,
				gpg_private_key,
				gpg_passphrase,
				push
			});
			results.push({ tag, action: "create", tag_obj_sha: out.tag_obj_sha });
		}

		rows.push(`| \`${tag}\` | \`${sha}\` |`);
	}

	const summary = `## Tag upsert results\n\n| Tag | Target SHA |\n| --- | --- |\n${rows.join("\n")}\n\n`;

	return { summary, report: results };
}
