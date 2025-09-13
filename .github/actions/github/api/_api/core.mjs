// Generic ESM helpers for GitHub REST API
import { debugLog } from "../../../common/common/core.mjs";

export function parseRepo(repoStr) {
	const [owner, repo] = (repoStr || "").split("/");
	if (!owner || !repo) throw new Error(`Invalid repo "${repoStr}" (expected owner/repo)`);
	return { owner, repo };
}

export async function api(method, path, body, { token, owner, repo }) {
	// Handle installation-level endpoints that don't require repo context
	const url = owner && repo ? `https://api.github.com/repos/${owner}/${repo}${path}` : `https://api.github.com${path}`;

	debugLog(`API URL: ${method} ${url}`);

	if (body) {
		debugLog("API request body:", JSON.stringify(body, null, 2));
	}

	const res = await fetch(url, {
		method,
		headers: {
			"Authorization": `Bearer ${token}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28"
		},
		body: body ? JSON.stringify(body) : undefined
	});

	debugLog(`API response: ${res.status} ${res.statusText}`);

	if (!res.ok) {
		const text = await res.text();
		debugLog("API error response:", text);
		throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
	}

	const result = res.status === 204 ? null : await res.json();
	if (result) {
		debugLog("API success response:", JSON.stringify(result, null, 2));
	}

	return result;
}

export async function revokeAppToken(token) {
	try {
		await api("DELETE", "/installation/token", null, { token });
		debugLog("Token revoked successfully");
	} catch (error) {
		console.warn(`Token revocation failed: ${error.message}`);
	}
}
