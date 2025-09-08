import { getRefTag } from "../../_api/tag.mjs";

export async function run({ token, repo, tag }) {
	const out = await getRefTag({ token, repo, tag });
	return {
		exists: out.exists ? "true" : "false",
		ref_sha: out.refSha || "",
		object_type: out.objectType || ""
	};
}
