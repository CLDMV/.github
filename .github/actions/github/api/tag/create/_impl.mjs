import fs from "node:fs";
import { sh } from "../../../../common/common/core.mjs";
import { ensureGitAuthRemote, configureGitIdentity, importGpgIfNeeded } from "../../_api/gpg.mjs";
import {
	getRefTag,
	getTagObject,
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
	gpg_enabled = false,
	tagger_name = "",
	tagger_email = "",
	gpg_private_key = "",
	gpg_passphrase = "",
	push = true
}) {
	debugLog(`create/_impl.run: Called with message="${message}"`);

	// Idempotency / tag-protection safety. The tags created here are IMMUTABLE
	// release tags (the rolling vN / vN.Y tags are MOVED by a separate action, not
	// this one). If the remote tag already points at the target commit it is already
	// correct, so skip creating and (force-)pushing it. This makes a re-run a true
	// no-op for tags already out, avoids needlessly re-signing an immutable tag, and
	// — crucially for retry — never trips a tag-protection rule that forbids
	// overwriting an existing tag (the force-push a retry would otherwise issue is
	// what reds the job). Only relevant when we would push; a local-only tag
	// (push=false) still goes through the normal path. The pre-check is best-effort:
	// any error falls through to the normal create path, which has its own handling.
	if (push) {
		try {
			const state = await getRefTag({ token, repo, tag });
			if (state.exists) {
				let targetCommit = state.refSha;
				if (state.objectType === "tag" && state.refSha) {
					// Annotated tag: deref the tag object to the commit it points at.
					const obj = await getTagObject({ token, repo, tagObjectSha: state.refSha });
					targetCommit = obj.exists ? obj.tag?.object?.sha || "" : "";
				}
				if (targetCommit && targetCommit === sha) {
					console.log(`✅ Tag ${tag} already points at ${sha} — skipping (immutable release tag already present).`);
					return { tag_obj_sha: state.objectType === "tag" ? state.refSha : "", ref_sha: state.refSha };
				}
				debugLog(`create/_impl: tag ${tag} exists at ${targetCommit || "?"} but target is ${sha} — will (re)create.`);
			}
		} catch (e) {
			debugLog(`create/_impl: idempotency pre-check failed (${e.message}); proceeding to create.`);
		}
	}

	// Fallback to API lightweight tag if push via git isn't possible
	try {
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
		console.warn("Git-based tagging failed, falling back to API tag creation:", e.message);
		debugLog(`create/_impl: API fallback starting for tag=${tag}, sha=${sha}`);
		debugLog(`create/_impl: API fallback params - gpg_enabled=${gpg_enabled}, tagger_name=${tagger_name}, tagger_email=${tagger_email}`);
		debugLog(`create/_impl: API fallback message="${message}"`);

		// Check if tag ref already exists
		debugLog(`create/_impl: Checking if tag ref exists...`);
		const state = await getRefTag({ token, repo, tag });
		debugLog(`create/_impl: Tag ref exists: ${state.exists}, refSha: ${state.refSha}, objectType: ${state.objectType}`);

		// Determine if we should create an annotated tag
		const shouldAnnotate = gpg_enabled || (message && message !== tag);
		debugLog(`create/_impl: shouldAnnotate=${shouldAnnotate} (gpg_enabled=${gpg_enabled}, message differs=${message !== tag})`);

		if (shouldAnnotate && tagger_name && tagger_email) {
			debugLog(`create/_impl: Creating annotated tag with API...`);
			// Always (re)create the annotated tag object and point the ref at it. Tag
			// objects are immutable, but creating a fresh one and moving the ref onto
			// it on a re-run is correct and keeps the tag ANNOTATED. Gating this on
			// `!state.exists` was a bug: when the ref already existed (a re-run) it
			// fell through to the lightweight branch below and force-moved the ref to a
			// bare commit, silently DOWNGRADING a previously annotated/signed tag to a
			// lightweight one. The ref upsert (create, else force-move) is handled
			// right below, so an existing ref is fine here.
			const tagger = { name: tagger_name, email: tagger_email };
			debugLog(`create/_impl: Tagger object: ${JSON.stringify(tagger)}`);

			try {
				const tagObj = await createAnnotatedTag({ token, repo, tag, message: message || tag, objectSha: sha, tagger });
				debugLog(`create/_impl: Annotated tag created successfully, tagObj.sha=${tagObj.sha}`);

				// Create the ref to point to the tag object
				debugLog(`create/_impl: Creating ref to point to tag object...`);
				try {
					const refResult = await createRefForTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });
					debugLog(`create/_impl: Ref created successfully: ${JSON.stringify(refResult)}`);
				} catch (refError) {
					debugLog(`create/_impl: Ref creation failed, trying force move: ${refError.message}`);
					const forceResult = await forceMoveRefToTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });
					debugLog(`create/_impl: Force move successful: ${JSON.stringify(forceResult)}`);
				}
				return { tag_obj_sha: tagObj.sha, ref_sha: tagObj.sha };
			} catch (tagError) {
				debugLog(`create/_impl: Annotated tag creation failed: ${tagError.message}`);
				throw tagError;
			}
		} else {
			debugLog(`create/_impl: Creating lightweight tag with API (shouldAnnotate=${shouldAnnotate}, state.exists=${state.exists})`);
			// Fallback to lightweight tag (or move existing ref)
			if (state.exists) {
				debugLog(`create/_impl: Moving existing ref to new commit...`);
				try {
					const moveResult = await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
					debugLog(`create/_impl: Ref moved successfully: ${JSON.stringify(moveResult)}`);
				} catch (moveError) {
					debugLog(`create/_impl: Ref move failed: ${moveError.message}`);
					throw moveError;
				}
			} else {
				debugLog(`create/_impl: Creating new lightweight tag ref...`);
				try {
					const createResult = await createRefToCommit({ token, repo, tag, commitSha: sha });
					debugLog(`create/_impl: Lightweight ref created successfully: ${JSON.stringify(createResult)}`);
				} catch (createError) {
					debugLog(`create/_impl: Lightweight ref creation failed, trying force move: ${createError.message}`);
					try {
						const forceResult = await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
						debugLog(`create/_impl: Force move successful: ${JSON.stringify(forceResult)}`);
					} catch (forceError) {
						debugLog(`create/_impl: Force move failed: ${forceError.message}`);
						throw forceError;
					}
				}
			}
			return { tag_obj_sha: "", ref_sha: sha };
		}
	}
}
