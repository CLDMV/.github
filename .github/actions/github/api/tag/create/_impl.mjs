import { getRefTag, createAnnotatedTag, createRefForTagObject, forceMoveRefToTagObject } from "../../../_api/tag.mjs";

export async function run({ token, repo, tag, sha, message }) {
	const tagObj = await createAnnotatedTag({ token, repo, tag, message, objectSha: sha });
	const state = await getRefTag({ token, repo, tag });

	if (state.exists) {
		await forceMoveRefToTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });
	} else {
		try {
			await createRefForTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });
		} catch {
			await forceMoveRefToTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });
		}
	}

	return { tag_obj_sha: tagObj.sha, ref_sha: tagObj.sha };
}
