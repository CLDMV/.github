import { sh } from "../../_api/core.mjs";
import { shouldSign, ensureGitAuthRemote, configureGitIdentity } from "../../_api/gpg.mjs";
import { inferAnnotate, getRefTag, createRefToCommit, forceMoveRefToCommit, importGpgIfNeeded } from "../../_api/tag.mjs";

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
	ensureGitAuthRemote(repo, token);
	const willSign = shouldSign({ sign, gpg_private_key });
	const willAnnotate = inferAnnotate({ annotate, sign: willSign ? "true" : "false", message });
	let keyid = "";
	if (willSign) keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
	configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign: willSign });
	if (willSign) {
		sh(`git tag -s -f -m "${message}" ${tag} ${sha}`);
	} else if (willAnnotate) {
		sh(`git tag -a -f -m "${message}" ${tag} ${sha}`);
	} else {
		sh(`git tag -f ${tag} ${sha}`);
	}
	if (push) sh(`git push origin +refs/tags/${tag}`);
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
