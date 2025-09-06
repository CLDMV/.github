// Generic ESM helpers for GitHub REST API
export function parseRepo(repoStr) {
	const [owner, repo] = (repoStr || "").split("/");
	if (!owner || !repo) throw new Error(`Invalid repo "${repoStr}" (expected owner/repo)`);
	return { owner, repo };
}

export async function api(method, path, body, { token, owner, repo }) {
	const url = `https://api.github.com/repos/${owner}/${repo}${path}`;
	const res = await fetch(url, {
		method,
		headers: {
			"Authorization": `Bearer ${token}`,
			"Accept": "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28"
		},
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
	}
	return res.status === 204 ? null : res.json();
}
