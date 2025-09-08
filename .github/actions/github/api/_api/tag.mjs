// Tag-focused helpers built on core
import { api, parseRepo } from "./core.mjs";

/**
 * Resolve refs/tags/<tag>.
 * Returns: { exists: boolean, refSha?: string, objectType?: 'tag'|'commit' }
 */
export async function getRefTag({ token, repo, tag }) {
	const { owner, repo: r } = parseRepo(repo);
	const enc = encodeURIComponent(tag);
	try {
		const data = await api("GET", `/git/ref/tags/${enc}`, null, { token, owner, repo: r });
		return { exists: true, refSha: data.object?.sha || "", objectType: data.object?.type || "" };
	} catch (err) {
		// Missing ref -> 404
		if (String(err.message).includes("404")) return { exists: false };
		throw err;
	}
}

/**
 * Fetch an annotated tag object by its SHA.
 * Returns:
 *   - { exists: true, tag: <raw tag object> }  on success
 *   - { exists: false }                        if 404
 *   - throws                                   on other errors
 */
export async function getTagObject({ token, repo, tagObjectSha }) {
	const { owner, repo: r } = parseRepo(repo);
	try {
		const tag = await api("GET", `/git/tags/${tagObjectSha}`, null, { token, owner, repo: r });
		return { exists: true, tag };
	} catch (err) {
		if (String(err.message).includes("404")) return { exists: false };
		throw err;
	}
}

/**
 * Create a VERIFIED annotated tag object pointing to a commit.
 * Returns the raw tag object JSON (includes .sha).
 */
export async function createAnnotatedTag({ token, repo, tag, message, objectSha }) {
	const { owner, repo: r } = parseRepo(repo);
	return api("POST", "/git/tags", { tag, message: message || tag, object: objectSha, type: "commit" }, { token, owner, repo: r });
}

/** Create refs/tags/<tag> pointing to a tag object SHA. */
export async function createRefForTagObject({ token, repo, tag, tagObjectSha }) {
	const { owner, repo: r } = parseRepo(repo);
	return api("POST", "/git/refs", { ref: `refs/tags/${tag}`, sha: tagObjectSha }, { token, owner, repo: r });
}

/** Force-move refs/tags/<tag> to a tag object SHA. */
export async function forceMoveRefToTagObject({ token, repo, tag, tagObjectSha }) {
	const { owner, repo: r } = parseRepo(repo);
	const enc = encodeURIComponent(tag);
	return api("PATCH", `/git/refs/tags/${enc}`, { sha: tagObjectSha, force: true }, { token, owner, repo: r });
}

/** Create refs/tags/<tag> pointing directly to a COMMIT SHA (lightweight tag). */
export async function createRefToCommit({ token, repo, tag, commitSha }) {
	const { owner, repo: r } = parseRepo(repo);
	return api("POST", "/git/refs", { ref: `refs/tags/${tag}`, sha: commitSha }, { token, owner, repo: r });
}

/** Force-move refs/tags/<tag> to a COMMIT SHA (lightweight tag). */
export async function forceMoveRefToCommit({ token, repo, tag, commitSha }) {
	const { owner, repo: r } = parseRepo(repo);
	const enc = encodeURIComponent(tag);
	return api("PATCH", `/git/refs/tags/${enc}`, { sha: commitSha, force: true }, { token, owner, repo: r });
}

export function inferAnnotate({ annotate, sign, message }) {
	if (annotate === "true") return true;
	if (annotate === "false") return false;
	// auto
	if (sign === "true") return true;
	if (message && message.length) return true;
	return false;
}
