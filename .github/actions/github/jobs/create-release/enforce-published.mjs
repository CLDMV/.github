/**
 * @fileoverview Force a freshly-created GitHub release out of draft state and
 * verify it. Node delegation step of the create-release action.
 * @module @cldmv/.github.github.jobs.create-release.enforce-published
 */

import { api, parseRepo } from "../../api/_api/core.mjs";

try {
	const token = process.env.GITHUB_TOKEN;
	const version = process.env.VERSION;
	const { owner, repo } = parseRepo(process.env.GITHUB_REPOSITORY);

	// Resolve the release ID, falling back to a lookup by tag.
	let releaseId = process.env.RELEASE_ID || "";
	if (!releaseId) {
		// VERSION carries the resolved tag; satellite tags (@scope/name@version)
		// contain "/" and "@" — encode so the path stays a single segment.
		const release = await api("GET", `/releases/tags/${encodeURIComponent(version)}`, null, { token, owner, repo });
		releaseId = release?.id ? String(release.id) : "";
	}
	if (!releaseId) {
		console.error(`::error::Could not resolve release ID for ${version}`);
		process.exit(1);
	}

	console.log(`ℹ️ Enforcing non-draft state for release ID ${releaseId}`);
	await api("PATCH", `/releases/${releaseId}`, { draft: false }, { token, owner, repo });

	const release = await api("GET", `/releases/${releaseId}`, null, { token, owner, repo });
	if (release.draft !== false) {
		console.error(`::error::Release ${version} is still draft after enforcement`);
		process.exit(1);
	}
	console.log(`✅ Release ${version} verified as published (draft=false)`);
} catch (error) {
	console.error(`::error::${error.message}`);
	process.exit(1);
}
