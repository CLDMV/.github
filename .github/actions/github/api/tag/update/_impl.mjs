import fs from "node:fs";
import { sh } from "../../../../common/common/core.mjs";
import { ensureGitAuthRemote, configureGitIdentity, importGpgIfNeeded } from "../../_api/gpg.mjs";
import {
	getRefTag,
	createRefToCommit,
	forceMoveRefToCommit,
	createAnnotatedTag,
	createRefForTagObject,
	forceMoveRefToTagObject
} from "../../_api/tag.mjs";
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
		console.warn("Git-based tagging failed, falling back to API tag update:", e.message);
		debugLog(`update/_impl: API fallback starting for tag=${tag}, sha=${sha}`);
		debugLog(`update/_impl: API fallback params - gpg_enabled=${gpg_enabled}, tagger_name=${tagger_name}, tagger_email=${tagger_email}`);
		debugLog(`update/_impl: API fallback message="${message}"`);

		// For updates, we always move existing refs rather than create new tag objects
		// (tag objects are immutable - can't create new ones with same name)
		debugLog(`update/_impl: Checking if tag ref exists...`);
		const state = await getRefTag({ token, repo, tag });
		debugLog(`update/_impl: Tag ref exists: ${state.exists}, refSha: ${state.refSha}, objectType: ${state.objectType}`);

		if (state.exists) {
			debugLog(`update/_impl: Moving existing ref to new commit...`);
			try {
				const moveResult = await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
				debugLog(`update/_impl: Ref moved successfully: ${JSON.stringify(moveResult)}`);
			} catch (moveError) {
				debugLog(`update/_impl: Ref move failed: ${moveError.message}`);
				throw moveError;
			}
		} else {
			debugLog(`update/_impl: Ref doesn't exist, treating as create operation`);
			// If ref doesn't exist, this is actually a create operation
			const shouldAnnotate = gpg_enabled || (message && message !== tag);
			debugLog(`update/_impl: shouldAnnotate=${shouldAnnotate} (gpg_enabled=${gpg_enabled}, message differs=${message !== tag})`);

			if (shouldAnnotate && tagger_name && tagger_email) {
				debugLog(`update/_impl: Creating annotated tag with API...`);
				const tagger = { name: tagger_name, email: tagger_email };
				debugLog(`update/_impl: Tagger object: ${JSON.stringify(tagger)}`);

				try {
					const tagObj = await createAnnotatedTag({ token, repo, tag, message: message || tag, objectSha: sha, tagger });
					debugLog(`update/_impl: Annotated tag created successfully, tagObj.sha=${tagObj.sha}`);

					const refResult = await createRefForTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });
					debugLog(`update/_impl: Ref created successfully: ${JSON.stringify(refResult)}`);
					return { tag_obj_sha: tagObj.sha, ref_sha: tagObj.sha };
				} catch (tagError) {
					debugLog(`update/_impl: Annotated tag creation failed: ${tagError.message}`);
					throw tagError;
				}
			} else {
				debugLog(`update/_impl: Creating lightweight tag with API...`);
				try {
					const createResult = await createRefToCommit({ token, repo, tag, commitSha: sha });
					debugLog(`update/_impl: Lightweight ref created successfully: ${JSON.stringify(createResult)}`);
				} catch (createError) {
					debugLog(`update/_impl: Lightweight ref creation failed: ${createError.message}`);
					throw createError;
				}
			}
		}
		debugLog(`update/_impl: API fallback completed successfully`);
		return { tag_obj_sha: "", ref_sha: sha };
	}
}
