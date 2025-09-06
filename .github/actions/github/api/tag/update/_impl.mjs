import { getRefTag, createAnnotatedTag, forceMoveRefToTagObject } from "../../_api/tag.mjs";

export async function run({ token, repo, tag, sha, message }) {
	const state = await getRefTag({ token, repo, tag });
	if (!state.exists) throw new Error(`Tag "${tag}" does not exist`);

	const tagObj = await createAnnotatedTag({ token, repo, tag, message, objectSha: sha });
	await forceMoveRefToTagObject({ token, repo, tag, tagObjectSha: tagObj.sha });

	return { tag_obj_sha: tagObj.sha, ref_sha: tagObj.sha };
}
