import fs from "node:fs";
import { sh } from "../../../common/common/core.mjs";
import { shouldSign, ensureGitAuthRemote, configureGitIdentity, importGpgIfNeeded } from "../../_api/gpg.mjs";
import { inferAnnotate, getRefTag, createRefToCommit, forceMoveRefToCommit } from "../../_api/tag.mjs";
import { debugLog } from "../../../../common/common/core.mjs";

function runGitSmartTag({
	repo,
	token,
	tag,
	sha,
	message,
	annotate,
	sign,
	tagger_name,
	tagger_email,
	gpg_private_key,
	gpg_passphrase,
	push
}) {
	debugLog(`runGitSmartTag: repo=${repo}, tag=${tag}, sha=${sha}`);
	debugLog(`runGitSmartTag: token starts with ${token?.substring(0, 10)}...`);
	debugLog(`runGitSmartTag: sign=${sign}, annotate=${annotate}, push=${push}`);
	debugLog(`runGitSmartTag: tagger_name=${tagger_name}, tagger_email=${tagger_email}`);
	debugLog(`runGitSmartTag: gpg_private_key present=${!!gpg_private_key}`);

	ensureGitAuthRemote(repo, token);
	const willSign = shouldSign({ sign, gpg_private_key });
	const willAnnotate = inferAnnotate({ annotate, sign: willSign ? "true" : "false", message });
	let keyid = "";
	if (willSign) keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
	configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign: willSign });

	debugLog(`runGitSmartTag: willSign=${willSign}, willAnnotate=${willAnnotate}`);

	// Ensure we have a message for annotated/signed tags to prevent Git editor from opening
	const tagMessage = message || `Update ${tag} tag`;
	debugLog(`runGitSmartTag: received message="${message}"`);
	debugLog(`runGitSmartTag: final tagMessage="${tagMessage}"`);

	if (willSign) {
		debugLog(`runGitSmartTag: Creating signed tag: git tag -s -f -F tempfile ${tag} ${sha}`);
		// Write message to temp file to handle multiline messages properly
		const tmpFile = `${process.env.RUNNER_TEMP || process.env.TEMP || "/tmp"}/tag-message-${Date.now()}.txt`;
		fs.writeFileSync(tmpFile, tagMessage, "utf8");
		sh(`git tag -s -f -F "${tmpFile}" ${tag} ${sha}`);
		fs.unlinkSync(tmpFile);
	} else if (willAnnotate) {
		debugLog(`runGitSmartTag: Creating annotated tag: git tag -a -f -F tempfile ${tag} ${sha}`);
		// Write message to temp file to handle multiline messages properly
		const tmpFile = `${process.env.RUNNER_TEMP || process.env.TEMP || "/tmp"}/tag-message-${Date.now()}.txt`;
		fs.writeFileSync(tmpFile, tagMessage, "utf8");
		sh(`git tag -a -f -F "${tmpFile}" ${tag} ${sha}`);
		fs.unlinkSync(tmpFile);
	} else {
		debugLog(`runGitSmartTag: Creating lightweight tag: git tag -f ${tag} ${sha}`);
		sh(`git tag -f ${tag} ${sha}`);
	}
	if (push) {
		debugLog(`runGitSmartTag: Pushing tag: git push origin +refs/tags/${tag}`);
		sh(`git push origin +refs/tags/${tag}`);
	}
	return { tag_obj_sha: "", ref_sha: sha };
}

export async function run({
	token,
	repo,
	tag,
	sha,
	message,
	sign = "auto",
	annotate = "auto",
	tagger_name = "",
	tagger_email = "",
	gpg_private_key = "",
	gpg_passphrase = "",
	push = true
}) {
	debugLog(`create/_impl.run: Called with message="${message}"`);
	// Fallback to API lightweight tag if push via git isn't possible
	try {
		return runGitSmartTag({
			repo,
			token,
			tag,
			sha,
			message,
			annotate,
			sign,
			tagger_name,
			tagger_email,
			gpg_private_key,
			gpg_passphrase,
			push
		});
	} catch (e) {
		console.warn("Git-based tagging failed, falling back to API lightweight tag:", e.message);
		const state = await getRefTag({ token, repo, tag });
		if (state.exists) {
			await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
		} else {
			try {
				await createRefToCommit({ token, repo, tag, commitSha: sha });
			} catch {
				await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
			}
		}
		return { tag_obj_sha: "", ref_sha: sha };
	}
}
