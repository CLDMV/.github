import { getRefTag, getTagObject } from "../../_api/tag.mjs";

export async function run({ token, repo, tag }) {
	const state = await getRefTag({ token, repo, tag });

	let exists = "false",
		tag_type = "",
		ref_sha = "",
		tag_obj_sha = "",
		is_signed = "false",
		verification_reason = "not_found";

	if (state.exists) {
		exists = "true";
		ref_sha = state.refSha || "";
		if ((state.objectType || "").toLowerCase() === "commit") {
			tag_type = "lightweight";
			verification_reason = "lightweight";
		} else {
			tag_type = "annotated";
			tag_obj_sha = ref_sha;

			const got = await getTagObject({ token, repo, tagObjectSha: tag_obj_sha });
			if (!got.exists) {
				// Extremely rare race; treat as not found
				is_signed = "false";
				verification_reason = "tag_object_not_found";
			} else {
				const ver = got.tag?.verification || {};
				is_signed = ver.verified ? "true" : "false";
				verification_reason = typeof ver.reason === "string" && ver.reason.length ? ver.reason : ver.verified ? "verified" : "unverified";
			}
		}
	}

	return { exists, tag_type, ref_sha, tag_obj_sha, is_signed, verification_reason };
}
