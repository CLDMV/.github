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
	return String(content).replace(tagPattern, "\\@$1");
}

export async function run({ token, repo, tag_name, name, body, is_prerelease, is_draft, assets, debug }) {
	const wantsDraft = toBoolean(is_draft, false);
	const wantsPrerelease = toBoolean(is_prerelease, false);
	const finalBody = neutralizeJsdocTagMentions(normalizeReleaseBody(body, name));

	debugLog(`Creating release for ${repo}:`);
	debugLog(`  tag_name: ${tag_name}`);
	debugLog(`  name: ${name}`);
	debugLog(`  is_prerelease: ${wantsPrerelease}`);
	debugLog(`  is_draft: ${wantsDraft}`);
	debugLog(`  body length: ${finalBody.length}`);
	debugLog(`  assets: ${assets}`);

	// Check if release already exists
	const existingReleaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag_name}`, {
		method: "GET",
		headers: {
			"Authorization": `token ${token}`,
			"Accept": "application/vnd.github.v3+json"
		}
	});

	let releaseData;

	if (existingReleaseResponse.ok) {
		// Release already exists
		releaseData = await existingReleaseResponse.json();
		debugLog(`Release ${tag_name} already exists (ID: ${releaseData.id}). Updating it...`);

		// Update the existing release
		const updatePayload = {
			name,
			body: finalBody,
			draft: wantsDraft,
			prerelease: wantsPrerelease
		};

		debugLog(`Update payload:`, JSON.stringify(updatePayload, null, 2));

		const updateResponse = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseData.id}`, {
			method: "PATCH",
			headers: {
				"Authorization": `token ${token}`,
				"Accept": "application/vnd.github.v3+json",
				"Content-Type": "application/json"
			},
			body: JSON.stringify(updatePayload)
		});

		if (!updateResponse.ok) {
			const errorText = await updateResponse.text();
			throw new Error(`Failed to update release: ${updateResponse.status} ${errorText}`);
		}

		releaseData = await updateResponse.json();

		debugLog(`Updated existing release: ${releaseData.id}`);
		debugLog(`Release flags after update -> draft: ${releaseData.draft}, prerelease: ${releaseData.prerelease}`);
	} else if (existingReleaseResponse.status === 404) {
		// Release doesn't exist, create new one
		const releasePayload = {
			tag_name,
			name,
			body: finalBody,
			draft: wantsDraft,
			prerelease: wantsPrerelease
		};

		debugLog(`Release payload:`, JSON.stringify(releasePayload, null, 2));

		const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases`, {
			method: "POST",
			headers: {
				"Authorization": `token ${token}`,
				"Accept": "application/vnd.github.v3+json",
				"Content-Type": "application/json"
			},
			body: JSON.stringify(releasePayload)
		});

		if (!releaseResponse.ok) {
			const errorText = await releaseResponse.text();
			throw new Error(`Failed to create release: ${releaseResponse.status} ${errorText}`);
		}

		releaseData = await releaseResponse.json();

		debugLog(`Created new release: ${releaseData.id}`);
		debugLog(`Release flags after create -> draft: ${releaseData.draft}, prerelease: ${releaseData.prerelease}`);
	} else {
		// Some other error checking for existing release
		const errorText = await existingReleaseResponse.text();
		throw new Error(`Failed to check for existing release: ${existingReleaseResponse.status} ${errorText}`);
	}

	// Respect caller intent: if non-draft was requested but GitHub still returns draft=true,
	// publish it explicitly. If draft was requested, keep it as draft.
	if (releaseData?.id && !wantsDraft && releaseData.draft === true) {
		debugLog(`Release ${releaseData.id} came back as draft=true while draft=false was requested; publishing it...`);

		const publishResponse = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseData.id}`, {
			method: "PATCH",
			headers: {
				"Authorization": `token ${token}`,
				"Accept": "application/vnd.github.v3+json",
				"Content-Type": "application/json"
			},
			body: JSON.stringify({ draft: false })
		});

		if (!publishResponse.ok) {
			const errorText = await publishResponse.text();
			throw new Error(`Failed to publish release: ${publishResponse.status} ${errorText}`);
		}

		releaseData = await publishResponse.json();
		debugLog(`Release ${releaseData.id} published successfully`);
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
					"Authorization": `token ${token}`,
					"Accept": "application/vnd.github.v3+json",
					"Content-Type": mimeType
				},
				body: fileContent
			});

			if (!uploadResponse.ok) {
				const errorText = await uploadResponse.text();
				console.error(`Failed to upload ${fileName}: ${uploadResponse.status} ${errorText}`);
			} else {
				debugLog(`Uploaded asset: ${fileName}`);
			}
		} catch (error) {
			console.error(`Error uploading ${assetPath}: ${error.message}`);
		}
	}
}
