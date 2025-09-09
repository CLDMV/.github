export async function run({ token, repo, tag_name, name, body, is_prerelease, is_draft, assets, debug }) {
	if (debug) {
		console.log(`🔍 Creating release for ${repo}:`);
		console.log(`  tag_name: ${tag_name}`);
		console.log(`  name: ${name}`);
		console.log(`  is_prerelease: ${is_prerelease}`);
		console.log(`  is_draft: ${is_draft}`);
		console.log(`  body length: ${body.length}`);
		console.log(`  assets: ${assets}`);
	}

	// Create the release via GitHub API
	const releasePayload = {
		tag_name,
		name,
		body,
		draft: is_draft,
		prerelease: is_prerelease
	};

	if (debug) {
		console.log(`🔍 Release payload:`, JSON.stringify(releasePayload, null, 2));
	}

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

	const releaseData = await releaseResponse.json();

	if (debug) {
		console.log(`✅ Created release: ${releaseData.id}`);
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
			if (debug) {
				console.log(`🔍 Uploading asset: ${assetPath}`);
			}

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
				console.error(`⚠️ Failed to upload ${fileName}: ${uploadResponse.status} ${errorText}`);
			} else {
				console.log(`✅ Uploaded asset: ${fileName}`);
			}
		} catch (error) {
			console.error(`⚠️ Error uploading ${assetPath}: ${error.message}`);
		}
	}
}
