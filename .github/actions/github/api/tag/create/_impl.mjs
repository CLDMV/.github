import { execSync } from "node:child_process";
import fs from "node:fs";
import { getRefTag, createRefToCommit, forceMoveRefToCommit } from "../../_api/tag.mjs";

const sh = (cmd, env={}) => execSync(cmd, { stdio: ["ignore","pipe","inherit"], env: { ...process.env, ...env } }).toString().trim();

function inferAnnotate({ annotate, sign, message }) {
  if (annotate === "true") return true;
  if (annotate === "false") return false;
  // auto
  if (sign === "true") return true;
  if (message && message.length) return true;
  return false;
}

function shouldSign({ sign, gpg_private_key }) {
  if (sign === "true") return true;
  if (sign === "false") return false;
  return Boolean(gpg_private_key && gpg_private_key.length);
}

function ensureGitAuthRemote(repo, token) {
  // set origin to include token for push
  const url = `https://x-access-token:${token}@github.com/${repo}.git`;
  sh(`git remote set-url origin "${url}"`);
  sh(`git fetch --tags --prune --force`);
}

function importGpgIfNeeded({ gpg_private_key, gpg_passphrase }) {
  if (!gpg_private_key) return "";
  fs.writeFileSync("/tmp/private.key", gpg_private_key, { encoding: "utf8" });
  sh(`gpg --batch --yes --pinentry-mode loopback --passphrase "${gpg_passphrase||''}" --import /tmp/private.key`);
  const keyid = sh(`gpg --list-secret-keys --keyid-format LONG | awk '/^sec/{print $2}' | sed 's#.*/##' | head -n1`);
  if (!keyid) throw new Error("No secret key imported");
  return keyid;
}

function configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign }) {
  if (tagger_name) sh(`git config user.name "${tagger_name}"`);
  if (tagger_email) sh(`git config user.email "${tagger_email}"`);
  if (enableSign) {
    if (keyid) sh(`git config user.signingkey ${keyid}`);
    sh(`git config commit.gpgsign true`);
    sh(`git config tag.gpgsign true`);
  }
}

function runGitSmartTag({ repo, token, tag, sha, message, annotate, sign, tagger_name, tagger_email, gpg_private_key, gpg_passphrase, push }) {
  ensureGitAuthRemote(repo, token);
  const willSign = shouldSign({ sign, gpg_private_key });
  const willAnnotate = inferAnnotate({ annotate, sign: willSign ? "true":"false", message });
  let keyid = "";
  if (willSign) keyid = importGpgIfNeeded({ gpg_private_key, gpg_passphrase });
  configureGitIdentity({ tagger_name, tagger_email, keyid, enableSign: willSign });
  if (willSign) {
        sh(`git tag -s -f -m "\1" ${tag} ${sha}`);
      } else if (willAnnotate) {
        sh(`git tag -a -f -m "\2" ${tag} ${sha}`);
      } else {
        sh(`git tag -f ${tag} ${sha}`);
      }
  if (push) sh(`git push origin +refs/tags/${tag}`);
  return { tag_obj_sha: "", ref_sha: sha };
}

export async function run({ token, repo, tag, sha, message, sign="auto", annotate="auto", tagger_name="", tagger_email="", gpg_private_key="", gpg_passphrase="", push=true }) {
  // Fallback to API lightweight tag if push via git isn't possible
  try {
    return runGitSmartTag({ repo, token, tag, sha, message, annotate, sign, tagger_name, tagger_email, gpg_private_key, gpg_passphrase, push });
  } catch (e) {
    console.warn("Git-based tagging failed, falling back to API lightweight tag:", e.message);
    const state = await getRefTag({ token, repo, tag });
    if (state.exists) {
      await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
    } else {
      try {
        await createRefToCommit({ token, repo, tag, commitSha: sha });
      } catch {
        await forceMoveRefToCommit({ token, repo, tag, commitSha: sha });
      }
    }
    return { tag_obj_sha: "", ref_sha: sha };
  }
}
