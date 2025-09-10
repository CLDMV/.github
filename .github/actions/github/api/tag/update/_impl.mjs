import fs from "node:fs";
import { sh } from "../../../../common/common/core.mjs";
import { ensureGitAuthRemote, configureGitIdentity, importGpgIfNeeded } from "../../_api/gpg.mjs";
import { getRefTag, createRefToCommit, forceMoveRefToCommit } from "../../_api/tag.mjs";
import { debugLog } from "../../../../common/common/core.mjs";

function runGitSmartTag({ repo, token, tag, sha, message, gpg_enabled, tagger_name, tagger_email, gpg_private_key, gpg_passphrase, push }) {
	debugLog(`runGitSmartTag: repo=${repo}, tag=${tag}, sha=${sha}`);
	debugLog(`runGitSmartTag: token starts with ${token?.substring(0, 10)}...`);
	debugLog(`runGitSmartTag: gpg_enabled=${gpg_enabled}, push=${push}`);
	debugLog(`runGitSmartTag: tagger_name=${tagger_name}, tagger_email=${tagger_email}`);
	debugLog(`runGitSmartTag: gpg_private_key present=${!!gpg_private_key}`);

	ensureGitAuthRemote(repo, token);
	const willSign = gpg_enabled && gpg_private_key;
	const willAnnotate = gpg_enabled; // Always annotate when GPG is enabled
	let keyid = "";
	if (willSign) keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
	configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign: willSign });

	// Ensure we have a message for annotated tags
	const tagMessage = message || `Update ${tag} tag`;

	debugLog(`runGitSmartTag: willSign=${willSign}, willAnnotate=${willAnnotate}`);

	if (willSign) {
		debugLog(`runGitSmartTag: Creating signed tag: git tag -s -f -m "${tagMessage}" ${tag} ${sha}`);
		// Write message to temp file to handle multiline messages properly
		const tmpFile = `${process.env.RUNNER_TEMP || process.env.TEMP || "/tmp"}/tag-message-${Date.now()}.txt`;
		fs.writeFileSync(tmpFile, tagMessage, "utf8");
		sh(`git tag -s -f -F "${tmpFile}" ${tag} ${sha}`);
		fs.unlinkSync(tmpFile);
	} else if (willAnnotate) {
		debugLog(`runGitSmartTag: Creating annotated tag: git tag -a -f -m "${tagMessage}" ${tag} ${sha}`);
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
	gpg_enabled = false,
	tagger_name = "",
	tagger_email = "",
	gpg_private_key = "",
	gpg_passphrase = "",
	push = true
}) {
	debugLog(`update/_impl.run: Called with message="${message}"`);
	// Fallback to API lightweight tag if push via git isn't possible
	try {
		debugLog(`update/_impl: About to call runGitSmartTag with message="${message}"`);
		return runGitSmartTag({
			repo,
			token,
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
	} catch (e) {
		debugLog(`update/_impl: runGitSmartTag failed: ${e.message}`);
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
