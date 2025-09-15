import { debugLog } from "../../../../common/common/core.mjs";

export async function run({ token, repo, tag_name, name, body, is_prerelease, is_draft, assets, debug }) {
	debugLog(`Creating release for ${repo}:`);
	debugLog(`  tag_name: ${tag_name}`);
	debugLog(`  name: ${name}`);
	debugLog(`  is_prerelease: ${is_prerelease}`);
	debugLog(`  is_draft: ${is_draft}`);
	debugLog(`  body length: ${body.length}`);
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
			body,
			draft: is_draft,
			prerelease: is_prerelease
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
	} else if (existingReleaseResponse.status === 404) {
		// Release doesn't exist, create new one
		const releasePayload = {
			tag_name,
			name,
			body,
			draft: is_draft,
			prerelease: is_prerelease
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
	} else {
		// Some other error checking for existing release
		const errorText = await existingReleaseResponse.text();
		throw new Error(`Failed to check for existing release: ${existingReleaseResponse.status} ${errorText}`);
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
