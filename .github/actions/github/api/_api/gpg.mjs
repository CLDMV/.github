import fs from "node:fs";
import { sh } from "./core.mjs";

export function importGpgIfNeeded({ gpg_private_key, gpg_passphrase }) {
	if (!gpg_private_key) return "";
	fs.writeFileSync("/tmp/private.key", gpg_private_key, { encoding: "utf8" });
	sh(`gpg --batch --yes --pinentry-mode loopback --passphrase "${gpg_passphrase || ""}" --import /tmp/private.key`);
	const keyid = sh(`gpg --list-secret-keys --keyid-format LONG | awk '/^sec/{print $2}' | sed 's#.*/##' | head -n1`);
	if (!keyid) throw new Error("No secret key imported");
	setupNonInteractiveGpg({ gpg_passphrase });
	return keyid;
}

export function shouldSign({ sign, gpg_private_key }) {
	if (sign === "true") return true;
	if (sign === "false") return false;
	return Boolean(gpg_private_key && gpg_private_key.length);
}

export function configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign }) {
	if (tagger_name) sh(`git config user.name "${tagger_name}"`);
	if (tagger_email) sh(`git config user.email "${tagger_email}"`);
	if (enableSign) {
		if (keyid) sh(`git config user.signingkey ${keyid}`);
		sh(`git config commit.gpgsign true`);
		sh(`git config tag.gpgsign true`);
	}
}

export function ensureGitAuthRemote(repo, token) {
	// set origin to include token for push
	const url = `https://x-access-token:${token}@github.com/${repo}.git`;
	sh(`git remote set-url origin "${url}"`);
	sh(`git fetch --tags --prune --force`);
}

export function setupNonInteractiveGpg({ gpg_passphrase }) {
	sh(`mkdir -p ~/.gnupg`);
	fs.writeFileSync(`${process.env.HOME}/.gnupg/gpg-agent.conf`, `allow-loopback-pinentry\n`);
	fs.writeFileSync(`${process.env.HOME}/.gnupg/gpg.conf`, `pinentry-mode loopback\n`);
	try {
		sh(`gpgconf --kill gpg-agent`);
	} catch {}
	try {
		sh(`gpgconf --launch gpg-agent`);
	} catch {}

	fs.writeFileSync(
		`/tmp/gpg-wrap.sh`,
		`#!/usr/bin/env bash\nexec gpg --batch --no-tty --pinentry-mode loopback ${
			gpg_passphrase ? '--passphrase "$GPG_PASSPHRASE"' : ""
		} "$@"\n`
	);
	sh(`chmod +x /tmp/gpg-wrap.sh`);
	sh(`git config gpg.program /tmp/gpg-wrap.sh`);

	const keyid = sh(`gpg --list-secret-keys --keyid-format LONG | awk '/^sec/{print $2}' | sed 's#.*/##' | head -n1`);
	if (keyid) {
		sh(`git config user.signingkey ${keyid}`);
		sh(`git config tag.gpgsign true`);
		sh(`git config commit.gpgsign true`);
	}
}
