import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureGitAuthRemote, configureGitIdentity, importGpgIfNeeded } from "../../_api/gpg.mjs";
import { getRefTag, getTagObject } from "../../_api/tag.mjs";
import { debugLog } from "../../../../common/common/core.mjs";
import { annotatedTagArgs } from "../../../../git/utilities/git-utils.mjs";

/**
 * Create a tag locally with git and (optionally) push it. No shell: every git
 * call takes an argument vector. Annotated/signed tags take their message from
 * a file with `--cleanup=verbatim`, so Markdown headings survive.
 *
 * There is deliberately NO fallback: if the push is refused, this throws with
 * the tag name and git's own error text. The old REST Git-Data fallback created
 * an annotated but UNSIGNED tag, and release tags must be bot-signed. (The
 * refusal it papered over — "refusing to allow a GitHub App to create or update
 * workflow … without workflows permission" — came from pushing with the
 * workflow GITHUB_TOKEN persisted by actions/checkout, which can never hold the
 * `workflows` scope; callers now push with an App token that requests it.)
 * @param {object} opts
 * @param {string} opts.tag - Tag name.
 * @param {string} opts.sha - Commit the tag points at.
 * @param {string} [opts.message] - Tag message (annotated/signed tags).
 * @param {boolean} [opts.annotate=false] - Create an annotated tag.
 * @param {boolean} [opts.sign=false] - GPG-sign the tag (implies annotate).
 * @param {boolean} [opts.push=true] - Push to `remote`.
 * @param {string} [opts.remote="origin"] - Remote name or URL to push to.
 * @param {string} [opts.cwd] - Repository directory.
 * @returns {void}
 */
export function createAndPushTag({
	tag,
	sha,
	message = "",
	annotate = false,
	sign = false,
	push = true,
	remote = "origin",
	cwd = process.cwd()
}) {
	if (!/^[\w.@+/-]+$/.test(tag) || tag.startsWith("-"))
		throw new Error(`Refusing to create a tag with an unexpected name: ${JSON.stringify(tag)}`);
	if (!/^[0-9a-f]{7,64}$/i.test(sha)) throw new Error(`Refusing to tag an unexpected object id for ${tag}: ${JSON.stringify(sha)}`);
	const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

	if (sign || annotate) {
		const dir = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "tag-msg-"));
		const messageFile = path.join(dir, "message.txt");
		fs.writeFileSync(messageFile, message || tag, "utf8");
		try {
			git(annotatedTagArgs({ tagName: tag, target: sha, messageFile, sign }));
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	} else {
		git(["tag", "-f", tag, sha]);
	}

	if (!push) return;
	try {
		git(["push", remote, `+refs/tags/${tag}:refs/tags/${tag}`]);
	} catch (error) {
		const detail = `${error.stdout || ""}${error.stderr || ""}`.trim() || error.message;
		throw new Error(`Push of tag ${tag} was refused — no tag was created on the remote. git said: ${detail}`, { cause: error });
	}
}

export async function run({
	token,
	repo,
	tag,
	sha,
	message,
	gpg_enabled = false,
	tagger_name = "",
	tagger_email = "",
	gpg_private_key = "",
	gpg_passphrase = "",
	push = true,
	// Test seams: skip the REST idempotency read and the token remote rewrite,
	// and push to a given remote instead of origin.
	skipPrecheck = false,
	configureRemote = true,
	remote = "origin",
	cwd = process.cwd()
}) {
	debugLog(`create/_impl.run: tag=${tag}, sha=${sha}, gpg_enabled=${gpg_enabled}, push=${push}`);

	// Idempotency / tag-protection safety. The tags created here are IMMUTABLE
	// release tags (the rolling vN / vN.Y tags are MOVED by a separate action, not
	// this one). If the remote tag already points at the target commit it is already
	// correct, so skip creating and (force-)pushing it. This makes a re-run a true
	// no-op for tags already out, avoids needlessly re-signing an immutable tag, and
	// never trips a tag-protection rule that forbids overwriting an existing tag.
	// Best-effort: any error falls through to the normal create path.
	if (push && !skipPrecheck) {
		try {
			const state = await getRefTag({ token, repo, tag });
			if (state.exists) {
				let targetCommit = state.refSha;
				if (state.objectType === "tag" && state.refSha) {
					const obj = await getTagObject({ token, repo, tagObjectSha: state.refSha });
					targetCommit = obj.exists ? obj.tag?.object?.sha || "" : "";
				}
				if (targetCommit && targetCommit === sha) {
					console.log(`✅ Tag ${tag} already points at ${sha} — skipping (immutable release tag already present).`);
					return { tag_obj_sha: state.objectType === "tag" ? state.refSha : "", ref_sha: state.refSha };
				}
				debugLog(`create/_impl: tag ${tag} exists at ${targetCommit || "?"} but target is ${sha} — will (re)create.`);
			}
		} catch (e) {
			debugLog(`create/_impl: idempotency pre-check failed (${e.message}); proceeding to create.`);
		}
	}

	if (configureRemote) ensureGitAuthRemote(repo, token);
	const sign = !!(gpg_enabled && gpg_private_key);
	let keyid = "";
	if (sign) keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
	configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign: sign });

	createAndPushTag({ tag, sha, message: message || tag, annotate: !!gpg_enabled, sign, push, remote, cwd });
	return { tag_obj_sha: "", ref_sha: sha };
}
