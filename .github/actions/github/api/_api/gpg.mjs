import fs from "node:fs";
import { sh } from "../../../common/common/core.mjs";

function exportGpgEnv({ gpg_passphrase }) {
	// make sure the wrapper (and gpg) can see the passphrase
	if (typeof gpg_passphrase === "string") {
		process.env.GPG_PASSPHRASE = gpg_passphrase;
	}
	// also ensure GNUPGHOME is consistent
	const home = process.env.HOME || "/home/runner";
	process.env.GNUPGHOME = process.env.GNUPGHOME || `${home}/.gnupg`;
}

export function importGpgIfNeeded({ gpg_private_key, gpg_passphrase }) {
	if (!gpg_private_key) return "";
	exportGpgEnv({ gpg_passphrase }); // <-- add this
	fs.writeFileSync("/tmp/private.key", gpg_private_key, "utf8");
	sh(`gpg --batch --yes --pinentry-mode loopback --passphrase "${gpg_passphrase || ""}" --import /tmp/private.key`);
	const keyid = sh(`gpg --list-secret-keys --keyid-format LONG | awk '/^sec/{print $2}' | sed 's#.*/##' | head -n1`);
	if (!keyid) throw new Error("No secret key imported");
	setupNonInteractiveGpg({ gpg_passphrase }); // (ok to keep as-is)
	return keyid;
}

export function setupNonInteractiveGpg({ gpg_passphrase }) {
	const home = process.env.HOME || "/home/runner";
	sh(`mkdir -p ${home}/.gnupg`);
	fs.writeFileSync(`${home}/.gnupg/gpg-agent.conf`, `allow-loopback-pinentry\n`);
	fs.writeFileSync(`${home}/.gnupg/gpg.conf`, `pinentry-mode loopback\n`);
	try {
		sh(`gpgconf --reload gpg-agent`);
	} catch {}
	try {
		sh(`gpgconf --launch gpg-agent`);
	} catch {}

	// wrapper that always enforces loopback and passes the env-based passphrase
	fs.writeFileSync(
		`/tmp/gpg-wrap.sh`,
		`#!/usr/bin/env bash
exec gpg --batch --no-tty --pinentry-mode loopback ${gpg_passphrase ? '--passphrase "$GPG_PASSPHRASE"' : ""} "$@"
`
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
