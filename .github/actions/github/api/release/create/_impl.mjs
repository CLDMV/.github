import { debugLog } from "../../../../common/common/core.mjs";

/**
 * Normalize arbitrary values to boolean.
 * @param {unknown} value - Input value.
 * @param {boolean} fallback - Fallback when value is undefined/null/empty.
 * @returns {boolean} Normalized boolean.
 */
function toBoolean(value, fallback = false) {
	if (typeof value === "boolean") {
		return value;
	}

	if (value === null || value === undefined) {
		return fallback;
	}

	const normalized = String(value).trim().toLowerCase();
	if (!normalized) {
		return fallback;
	}

	if (["true", "1", "yes", "on"].includes(normalized)) {
		return true;
	}

	if (["false", "0", "no", "off"].includes(normalized)) {
		return false;
	}

	return fallback;
}

/**
 * Remove duplicated title lines from the beginning of release body.
 * This handles cases where the commit message subject is also present
 * as the first line of the body.
 * @param {string} body - Raw release body markdown.
 * @param {string} title - Release title/name.
 * @returns {string} Normalized release body.
 */
function normalizeReleaseBody(body, title) {
	if (!body) {
		return "";
	}

	const normalizedBody = String(body).replace(/\r\n/g, "\n");
	const normalizedTitle = (title || "").trim();

	if (!normalizedTitle) {
		return normalizedBody;
	}

	const lines = normalizedBody.split("\n");
	const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0);

	if (firstNonEmptyIndex === -1) {
		return normalizedBody;
	}

	const firstLine = lines[firstNonEmptyIndex].trim();
	if (firstLine.toLowerCase() === normalizedTitle.toLowerCase()) {
		lines.splice(firstNonEmptyIndex, 1);
		while (lines.length > 0 && lines[0].trim() === "") {
			lines.shift();
		}
	}

	return lines.join("\n");
}

/**
 * Escape JSDoc-style tags in release body so they are not interpreted as GitHub mentions.
 * @param {string} content - Release body markdown.
 * @returns {string} Sanitized release body.
 */
function neutralizeJsdocTagMentions(content) {
	if (!content) {
		return "";
	}

	const jsdocTags = [
		"abstract",
		"access",
		"alias",
		"async",
		"augments",
		"author",
		"borrows",
		"callback",
		"class",
		"classdesc",
		"constant",
		"constructs",
		"default",
		"deprecated",
		"description",
		"enum",
		"event",
		"example",
		"exports",
		"extends",
		"external",
		"file",
		"fires",
		"function",
		"generator",
		"global",
		"hideconstructor",
		"ignore",
		"implements",
		"inheritdoc",
		"inner",
		"instance",
		"interface",
		"kind",
		"lends",
		"license",
		"listens",
		"member",
		"memberof",
		"mixes",
		"mixin",
		"module",
		"name",
		"namespace",
		"override",
		"package",
		"param",
		"private",
		"property",
		"protected",
		"public",
		"readonly",
		"returns",
		"return",
		"see",
		"since",
		"static",
		"summary",
		"template",
		"this",
		"throws",
		"todo",
		"tutorial",
		"type",
		"typedef",
		"variation",
		"version",
		"yields",
		"yield",
		"internal"
	];

	const tagPattern = new RegExp(`@(${jsdocTags.join("|")})(?=$|[\\s.,;:!?()[\\]{}])`, "gi");
	return String(content).replace(tagPattern, "@​$1");
}

/**
 * Find a release for `tag_name`, published OR draft.
 *
 * Deliberately does NOT use GET /repos/{repo}/releases/tags/{tag} — that
 * endpoint is documented to not return a release that is currently a draft
 * (GitHub excludes drafts from tag lookups by design). A stale draft would
 * be invisible to that check forever: every future run would read "doesn't
 * exist" and create a brand-new duplicate release for the same tag instead
 * of fixing the orphaned one. Paging through the full releases list (which
 * DOES include drafts for a token with push access) and matching tag_name in
 * memory is the only reliable way to find an existing release regardless of
 * its draft state.
 * @param {object} params
 * @param {string} params.repo - "owner/repo".
 * @param {string} params.tag_name - Tag name to match against `release.tag_name`.
 * @param {() => Record<string,string>} params.apiHeaders - Header builder.
 * @returns {Promise<object|null>} The matching release (any state), or null if none exists.
 */
async function findExistingRelease({ repo, tag_name, apiHeaders }) {
	for (let page = 1; page <= 10; page++) {
		const listResponse = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, {
			method: "GET",
			headers: apiHeaders()
		});

		if (!listResponse.ok) {
			const errorText = await listResponse.text();
			throw new Error(`Failed to list releases while searching for ${tag_name}: ${listResponse.status} ${errorText}`);
		}

		const pageItems = await listResponse.json();
		const match = pageItems.find((r) => r.tag_name === tag_name);
		if (match) {
			debugLog(`Found existing release for ${tag_name} (ID: ${match.id}, draft: ${match.draft}, page ${page})`);
			return match;
		}

		if (pageItems.length < 100) break; // last page
	}

	return null;
}

export async function run({ token, repo, tag_name, name, body, is_prerelease, is_draft, make_latest, assets, debug }) {
	const wantsDraft = toBoolean(is_draft, false);
	const wantsPrerelease = toBoolean(is_prerelease, false);
	// Tri-state: only include make_latest in the API payload when the caller
	// explicitly asked for "true"/"false"/"legacy". Empty/unset means "don't
	// send the field" — GitHub applies its own default (true) for the core
	// release. Satellite releases pass "false" so they never steal the
	// "Latest release" badge from the core release that created them.
	const wantsMakeLatest = ["true", "false", "legacy"].includes(String(make_latest || "").trim().toLowerCase())
		? String(make_latest).trim().toLowerCase()
		: undefined;
	const finalBody = neutralizeJsdocTagMentions(normalizeReleaseBody(body, name));
	// Satellite tags (@scope/name@version) contain "/" and "@"; encode the tag in
	// URL path segments so the lookups below resolve. No-op for core v<version>.
	const encTag = encodeURIComponent(tag_name);

	/**
	 * Standard GitHub API headers using current API version.
	 * @returns {Record<string, string>}
	 */
	function apiHeaders() {
		return {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2026-03-10",
			"Content-Type": "application/json"
		};
	}

	debugLog(`Creating release for ${repo}:`);
	debugLog(`  tag_name: ${tag_name}`);
	debugLog(`  name: ${name}`);
	debugLog(`  is_prerelease: ${wantsPrerelease}`);
	debugLog(`  is_draft: ${wantsDraft}`);
	debugLog(`  body length: ${finalBody.length}`);
	debugLog(`  assets: ${assets}`);

	// Wait for the tag ref to be resolvable on GitHub before creating the release.
	// If we proceed immediately after tag creation the GitHub API may still return 404
	// for the ref, causing the release to be created against an untagged SHA — which
	// GitHub marks as draft by default and names "untagged-<sha>".
	{
		const maxAttempts = 12;
		const delayMs = 5000;
		let tagReady = false;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const tagCheckResponse = await fetch(`https://api.github.com/repos/${repo}/git/refs/tags/${encTag}`, {
				method: "GET",
				headers: apiHeaders()
			});
			if (tagCheckResponse.ok) {
				tagReady = true;
				debugLog(`Tag ref ${tag_name} confirmed on GitHub API (attempt ${attempt})`);
				break;
			}
			debugLog(`Tag ref ${tag_name} not yet visible (attempt ${attempt}/${maxAttempts}, status ${tagCheckResponse.status}) — waiting ${delayMs}ms`);
			await new Promise((r) => setTimeout(r, delayMs));
		}
		if (!tagReady) {
			throw new Error(`Tag ${tag_name} was not resolvable via GitHub API after ${maxAttempts} attempts. Cannot create release against a missing tag.`);
		}
	}

	// Check if release already exists — see findExistingRelease() for why this
	// lists releases instead of using the tag-scoped lookup (which is blind to
	// drafts by GitHub's own design).
	const existingRelease = await findExistingRelease({ repo, tag_name, apiHeaders });

	let releaseData;

	if (existingRelease) {
		// Release already exists (published OR draft — see findExistingRelease).
		releaseData = existingRelease;
		debugLog(`Release ${tag_name} already exists (ID: ${releaseData.id}, draft: ${releaseData.draft}). Updating it...`);

		// Update the existing release
		const updatePayload = {
			name,
			body: finalBody,
			draft: wantsDraft,
			prerelease: wantsPrerelease,
			...(wantsMakeLatest !== undefined ? { make_latest: wantsMakeLatest } : {})
		};

		debugLog(`Update payload:`, JSON.stringify(updatePayload, null, 2));

		const updateResponse = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseData.id}`, {
			method: "PATCH",
			headers: apiHeaders(),
			body: JSON.stringify(updatePayload)
		});

		if (!updateResponse.ok) {
			const errorText = await updateResponse.text();
			throw new Error(`Failed to update release: ${updateResponse.status} ${errorText}`);
		}

		releaseData = await updateResponse.json();

		debugLog(`Updated existing release: ${releaseData.id}`);
		debugLog(`Release flags after update -> draft: ${releaseData.draft}, prerelease: ${releaseData.prerelease}`);
	} else {
		// Release doesn't exist (published or draft), create new one
		const releasePayload = {
			tag_name,
			name,
			body: finalBody,
			draft: wantsDraft,
			prerelease: wantsPrerelease,
			...(wantsMakeLatest !== undefined ? { make_latest: wantsMakeLatest } : {})
		};

		debugLog(`Release payload:`, JSON.stringify(releasePayload, null, 2));

		const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases`, {
			method: "POST",
			headers: apiHeaders(),
			body: JSON.stringify(releasePayload)
		});

		if (!releaseResponse.ok) {
			const errorText = await releaseResponse.text();
			throw new Error(`Failed to create release: ${releaseResponse.status} ${errorText}`);
		}

		releaseData = await releaseResponse.json();

		debugLog(`Created new release: ${releaseData.id}`);
		debugLog(`Release flags after create -> draft: ${releaseData.draft}, prerelease: ${releaseData.prerelease}`);
	}

	// Respect caller intent: when draft=false is requested, always perform a final
	// publish pass and verify persisted state from a fresh API read.
	//
	// This is the ONE enforcement pass (a near-duplicate second pass used to
	// live in a separate "Enforce published release state" step —
	// enforce-published.mjs — removed as redundant: both ran the identical
	// PATCH+GET-verify sequence back to back for no added benefit).
	//
	// It retries the PATCH+verify pair rather than doing it once, because a
	// single-shot verification immediately after the PATCH can observe a stale
	// read (GitHub's own release-creation pipeline has more than one internal
	// consistency domain — see the tag-readiness wait above, which exists for
	// exactly this class of lag). Real-world evidence points to something
	// slower than ordinary read lag, though: a job's own verification GET can
	// report draft=false and still have the release read back as draft
	// afterward (from the web/mobile UI, and from a fresh API call run
	// later) — consistent with an async reconciliation between a freshly
	// signed/annotated tag and the release object that lands after this
	// job's original one-shot check already declared success. The wide retry
	// window below is aimed at that slower class of lag, not just an
	// immediate stale read.
	if (releaseData?.id && !wantsDraft) {
		// Wide window (up to ~4 minutes total): the reversion this guards against
		// appears to be an async GitHub-side reconciliation between a freshly
		// signed/annotated tag and the release object, not a simple few-second
		// read lag — a short retry window can verify success and still lose the
		// race to a later silent revert. Only paid when something's actually
		// wrong; a healthy publish exits the loop on attempt 1.
		const maxAttempts = 15;
		const retryDelayMs = 15000;
		let verifiedPublished = false;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			debugLog(`Finalizing release ${releaseData.id} as non-draft (enforced publish pass, attempt ${attempt}/${maxAttempts})...`);

			const publishResponse = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseData.id}`, {
				method: "PATCH",
				headers: apiHeaders(),
				body: JSON.stringify({ draft: false })
			});

			if (!publishResponse.ok) {
				const errorText = await publishResponse.text();
				throw new Error(`Failed to publish release: ${publishResponse.status} ${errorText}`);
			}

			releaseData = await publishResponse.json();
			debugLog(`Release ${releaseData.id} publish PATCH applied (draft=${releaseData.draft})`);

			const verifyResponse = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseData.id}`, {
				method: "GET",
				headers: apiHeaders()
			});

			if (!verifyResponse.ok) {
				const errorText = await verifyResponse.text();
				throw new Error(`Failed to verify release publish state: ${verifyResponse.status} ${errorText}`);
			}

			releaseData = await verifyResponse.json();
			debugLog(`Release ${releaseData.id} verification -> draft: ${releaseData.draft}, prerelease: ${releaseData.prerelease}`);

			if (releaseData.draft !== true) {
				verifiedPublished = true;
				break;
			}

			debugLog(`Release ${releaseData.id} still reads draft after PATCH+verify (attempt ${attempt}/${maxAttempts}) — retrying in ${retryDelayMs}ms`);
			await new Promise((r) => setTimeout(r, retryDelayMs));
		}

		if (!verifiedPublished) {
			throw new Error(`Release ${releaseData.id} is still draft after ${maxAttempts} publish-enforcement attempts`);
		}
	}

	const result = {
		release_id: releaseData.id,
		html_url: releaseData.html_url,
		upload_url: releaseData.upload_url
	};

	// Upload assets if provided
	if (assets && assets.trim()) {
		await uploadAssets({
			token,
			repo,
			release_id: releaseData.id,
			upload_url: releaseData.upload_url,
			assets: assets
				.split(",")
				.map((a) => a.trim())
				.filter(Boolean),
			debug
		});
	}

	return result;
}

async function uploadAssets({ token, repo, release_id, upload_url, assets, debug }) {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");

	// Simple mime type lookup for common package files
	function getMimeType(filePath) {
		const ext = path.extname(filePath).toLowerCase();
		const mimeTypes = {
			".tgz": "application/gzip",
			".tar.gz": "application/gzip",
			".zip": "application/zip",
			".tar": "application/x-tar",
			".json": "application/json",
			".txt": "text/plain",
			".md": "text/markdown"
		};
		return mimeTypes[ext] || "application/octet-stream";
	}

	for (const assetPath of assets) {
		try {
			debugLog(`Uploading asset: ${assetPath}`);

			// Check if file exists
			await fs.access(assetPath);

			const fileName = path.basename(assetPath);
			const mimeType = getMimeType(assetPath);
			const fileContent = await fs.readFile(assetPath);

			// GitHub upload URL format: {upload_url}{?name,label}
			const uploadUrlBase = upload_url.replace("{?name,label}", "");
			const finalUploadUrl = `${uploadUrlBase}?name=${encodeURIComponent(fileName)}`;

			const uploadResponse = await fetch(finalUploadUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2026-03-10",
					"Content-Type": mimeType
				},
				body: fileContent
			});

			if (!uploadResponse.ok) {
				const errorText = await uploadResponse.text();
				// An asset with this name already exists on the release — GitHub returns
				// 422 already_exists. This is the normal case on a re-run after a partial
				// failure: release assets are immutable per (tag, name) and the satellite
				// tarballs are deterministic from the same artifact, so the existing asset
				// is already correct. Treat it as a benign no-op instead of logging a scary
				// error on every retry. Any other non-OK status is still a real failure.
				if (uploadResponse.status === 422 && /already_exists/.test(errorText)) {
					console.log(`ℹ️ Asset ${fileName} already present on the release — skipping (idempotent re-run).`);
				} else {
					console.error(`Failed to upload ${fileName}: ${uploadResponse.status} ${errorText}`);
				}
			} else {
				debugLog(`Uploaded asset: ${fileName}`);
			}
		} catch (error) {
			console.error(`Error uploading ${assetPath}: ${error.message}`);
		}
	}
}
