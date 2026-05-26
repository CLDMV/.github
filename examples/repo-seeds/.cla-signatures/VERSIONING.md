# CLA Versioning Policy

CLA versions follow a `major.minor.patch` scheme, where each level signals a different kind of change. The bot, the audit tooling, and contributor signatures all interpret the version at `major.minor` granularity — `patch` is reserved for purely cosmetic fixes.

## What each level means

| Level | Triggers re-signing? | Examples |
|---|---|---|
| **Major** (`v1.0` → `v2.0`) | Yes | Fundamental terms change: scope of the license grant, jurisdiction, addition or removal of a patent clause. |
| **Minor** (`v1.0` → `v1.1`) | Yes | Wording changes that affect meaning, clarification of a clause that shifts interpretation, added or removed exemption. |
| **Patch** (`v1.0` → `v1.0.1`) | **No** | Spelling fixes, typo corrections, pure formatting (whitespace, list markers, line breaks). No change in meaning. |

## Why the bot only sees major.minor

The signature record's `agreement.cla_version` is recorded as `v1.0` — patch is intentionally omitted. The bot's signature path (`signatures/github/v1.0/...`), the user-facing required text ("I have read and I agree to the CLA v1.0"), and the audit tool's query keys all use `major.minor`. A patch-level fix is a fact in this repository's git history, not a new agreement.

Each signature record additionally captures:

- `agreement.cla_sha256` — the SHA-256 of the agreement text at the exact moment of signing.
- `agreement.cla_url_at_signing` — a commit-pinned URL to the exact text the contributor agreed to.

So even after a patch lands, any earlier signature can still be verified against the exact text the contributor saw and agreed to. `tools/verify.mjs` does this automatically.

## How the CLA text is stored

The canonical agreement texts live in [`cla-versions/`](cla-versions/), one file per minor version. There are two parallel hierarchies, one per scope:

**Default scope** (org-wide CLA):

- `cla-versions/v1.0.md` — the current text of the org-wide default CLA v1.0, including any patch-level fixes applied to it.
- `cla-versions/v1.0.sha256` — the SHA-256 of the file above (regenerated whenever the file is updated).

**Override scope** (per-consumer-repo CLA snapshots):

- `cla-versions/overrides/<owner>/<repo>/v1.0.md` — the **immutable snapshot** of the consumer repo's `CLA.md` as it stood when the first signature for that scope+version was recorded. Never updated after creation.
- `cla-versions/overrides/<owner>/<repo>/v1.0.sha256` — its SHA-256.

The two trees follow the same versioning policy, but the override workflows differ — see below.

### Patch fix workflow (default scope)

1. Edit the affected `cla-versions/v<X.Y>.md` file in this ledger in place to incorporate the fix.
2. Regenerate the corresponding `.sha256` file via `node tools/verify.mjs --regen-hashes`.
3. Apply the same edit to the **public sample CLA** at [`examples/repo-seeds/.cla-signatures/cla-versions/v<X.Y>.md`](https://github.com/CLDMV/.github/tree/master/examples/repo-seeds/.cla-signatures/cla-versions) in `CLDMV/.github`. The sample is independent (it's what consumer repos copy from when scaffolding a local `CLA.md`); keeping it in step with the binding text is a maintenance discipline, not an architectural requirement.
4. Commit both with a `fix(cla):` message. Git history preserves the diff.

No bot input change. No re-signing prompt to contributors.

### Minor / major bump workflow (default scope)

1. Create a new `cla-versions/v<X.Y>.md` file alongside the existing ones in this ledger (do not overwrite previous versions).
2. Generate its `.sha256` via `node tools/verify.mjs --regen-hashes`.
3. Add the corresponding `cla-versions/v<X.Y>.md` to the **public sample CLA** at [`examples/repo-seeds/.cla-signatures/cla-versions/`](https://github.com/CLDMV/.github/tree/master/examples/repo-seeds/.cla-signatures/cla-versions) in `CLDMV/.github` so consumers scaffolding a new repo find the latest version.
4. Bump the `cla_version:` input in the consumer-repo workflow template at [`CLDMV/.github/examples/individual-repo-workflows/security/cla.yml`](https://github.com/CLDMV/.github/blob/master/examples/individual-repo-workflows/security/cla.yml).
5. Each consumer repo picks up the new version on its next workflow run (no per-repo change required if they pin to the floating tag).
6. Contributors are prompted to re-sign on their next PR. The bot writes new files under `signatures/github/v<X.Y>/...`; older-version records under `signatures/github/v<X.Y-1>/...` are preserved untouched.

## Override CLAs (per-consumer-repo)

When a consumer repo includes its own `CLA.md` at the root, the bot uses **override scope**. The override text and its versioning live in the consumer's repo — this ledger only stores the immutable snapshots and the signatures.

### How override versions are detected

The bot reads the version from the consumer `CLA.md`'s **first-line H1 header**:

```
# CLDMV Contributor License Agreement (CLA) — v1.0
                                              ^^^^
```

A version token of the form `v<major>.<minor>` (or `v<major>.<minor>.<patch>`) anywhere on the first line is normalized to `major.minor`. The workflow's `cla_version` input is only used as a fallback if the header can't be parsed.

### First-signer bootstrap

The first time anyone signs an override at `(<owner>/<repo>, v<X.Y>)`, the bot writes the consumer's current `CLA.md` text into `cla-versions/overrides/<owner>/<repo>/v<X.Y>.md` (with its `.sha256`). That snapshot is **immutable**. Subsequent signers at the same scope+version are bound to the snapshot's text.

### Override patch fix workflow

The consumer edits their `CLA.md` for a typo or formatting fix. They **do not** change the version in the header.

The bot's drift check on the next signature attempt:

1. Bot fetches the consumer's current `CLA.md` → sha A.
2. Bot looks up `cla-versions/overrides/<owner>/<repo>/v<X.Y>.md` → sha B.
3. If A ≠ B, the bot **fails loudly** with a remediation message: either revert the consumer edit, or bump the header version.

Conclusion: in this ledger's model, **the snapshot is the binding text**. Once it's bootstrapped, the consumer can't patch their override's text without bumping the version. This is intentional — a "patch" to an override CLA after anyone has signed would silently change what those signers agreed to.

To apply a true patch (no meaning change), the maintainer must:

1. Revert the consumer's `CLA.md` to the snapshot text in the ledger.
2. Or, treat it as a minor bump: increment the header version (e.g. `v1.0` → `v1.1`).

### Override minor / major bump workflow

1. The consumer edits their `CLA.md`: new text, new header version (e.g. `v1.0` → `v1.1`).
2. On the next PR, the bot detects override scope, parses the new version from the header, and looks up `cla-versions/overrides/<owner>/<repo>/v1.1.md` — finds nothing (404).
3. The first signer's record action **bootstraps** the new snapshot: writes `cla-versions/overrides/<owner>/<repo>/v1.1.md` and its `.sha256`, then writes the signature file.
4. Contributors who only signed v1.0 are prompted to re-sign for v1.1 on their next PR.

The old v1.0 snapshot at `cla-versions/overrides/<owner>/<repo>/v1.0.md` and its signatures remain untouched — past agreements are not invalidated retroactively.

## Authoritative source

This document is the authoritative definition of the versioning policy. The CLA file itself at [`cla-versions/v1.0.md`](cla-versions/v1.0.md) includes a short summary referencing this policy.
