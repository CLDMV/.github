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
			"X-GitHub-Api-Version": "2026-03-10"
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

/**
 * Paginate a GET endpoint and return all results as a single array.
 * Honors GitHub's Link headers; stops at maxPages as a safety cap.
 * Tracks X-RateLimit-Remaining and aborts (returning what's been collected
 * so far) if remaining drops below `rateLimitFloor`. Used by the stale
 * sweep and any other action that walks a paginated listing.
 *
 * @param {string} path - GET path including any base query params; pagination is appended.
 * @param {object} ctx - { token, owner, repo, maxPages?, perPage?, rateLimitFloor? }
 * @returns {Promise<{items: any[], rateLimitedOut: boolean, lastRemaining: number}>}
 */
export async function paginate(path, ctx) {
	const { token, owner, repo, maxPages = 50, perPage = 100, rateLimitFloor = 200 } = ctx;
	const items = [];
	let rateLimitedOut = false;
	let lastRemaining = Infinity;

	for (let page = 1; page <= maxPages; page++) {
		const sep = path.includes("?") ? "&" : "?";
		const url = owner && repo
			? `https://api.github.com/repos/${owner}/${repo}${path}${sep}per_page=${perPage}&page=${page}`
			: `https://api.github.com${path}${sep}per_page=${perPage}&page=${page}`;
		debugLog(`paginate GET ${url}`);
		const res = await fetch(url, {
			headers: {
				"Authorization": `Bearer ${token}`,
				"Accept": "application/vnd.github+json",
				"X-GitHub-Api-Version": "2026-03-10"
			}
		});
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`paginate GET ${path} (page ${page}) -> ${res.status}: ${text}`);
		}
		const remaining = Number(res.headers.get("x-ratelimit-remaining") || Infinity);
		lastRemaining = remaining;
		const batch = await res.json();
		if (!Array.isArray(batch)) {
			throw new Error(`paginate: expected array response, got ${typeof batch}`);
		}
		items.push(...batch);
		if (batch.length < perPage) break;
		if (remaining < rateLimitFloor) {
			console.log(`::warning::Rate limit remaining=${remaining} below floor=${rateLimitFloor}; aborting pagination at page ${page} with ${items.length} items collected.`);
			rateLimitedOut = true;
			break;
		}
	}
	return { items, rateLimitedOut, lastRemaining };
}

export async function revokeAppToken(token) {
	try {
		await api("DELETE", "/installation/token", null, { token });
		debugLog("Token revoked successfully");
	} catch (error) {
		console.warn(`Token revocation failed: ${error.message}`);
	}
}
