# CLDMV CLA Signatures Ledger

The authoritative record of CLA acceptances for contributions to CLDMV projects. Each signed acceptance lives here as an immutable JSON file; the CLA bot writes a new file here whenever a contributor agrees to a CLA version.

**This repository is private.** Signature records contain commit-author email addresses and other identifying metadata that should not be aggregated into a public, searchable index. The CLA bot reads and writes the ledger via a GitHub App installation token; org members can clone the repository for internal audit. External contributors cannot browse the ledger directly — see [Auditing a signature](#auditing-a-signature) below for how a contributor verifies their own signature.

## What's in here

- **[`cla-versions/`](cla-versions/)** — Immutable archive of every published CLA version (e.g. `v1.0.md`). The exact text a contributor signed against is always recoverable from this directory.
- **[`signatures/`](signatures/)** — One JSON file per signer per CLA version, organized as `signatures/<platform>/<version>/<shard>/<id>.json`. See [Layout](#layout) below.
- **[`tools/`](tools/)** — Audit and integrity-verification scripts. Run `node tools/audit.mjs --help` for usage.
- **[`VERSIONING.md`](VERSIONING.md)** — Policy describing how CLA versions are numbered and when re-signing is required.

## Layout

Each signature lives at a deterministic path:

```
signatures/<platform>/<major.minor>/<shard>/<id>.json
```

- **`<platform>`** — `github` (other platforms slot in if/when needed).
- **`<major.minor>`** — The CLA version the signature covers (e.g. `v1.0`). Patch-level changes never produce a new directory; see [VERSIONING.md](VERSIONING.md).
- **`<shard>`** — First three hex characters of `sha256(<id>)`, distributing files evenly across up to 4096 buckets so no directory grows beyond a few hundred entries even at very large scale.
- **`<id>`** — The contributor's immutable platform user ID (numeric for GitHub). Choosing the immutable ID means renames of the contributor's login do not move or duplicate their record.

A contributor who signed CLA v1.0 with GitHub user ID `583231` has their record at:

```
signatures/github/v1.0/a4c/583231.json
```

(`a4c` is `sha256("583231")` truncated to three characters.)

## Auditing a signature

### For contributors

Your CLA receipt is the bot's acknowledgment comment on the PR where you signed. It contains a stable `signature_id` (a SHA-256 hash anchoring your full record) plus the CLA version and timestamps. Keep that comment as your receipt.

If you need to confirm your signature is still on file, just open a new PR — the bot will silently pass the CLA check rather than asking you to re-sign.

### For org-internal audit

Clone this repository (requires org membership) and use the audit tool:

```bash
node tools/audit.mjs octocat            # by login
node tools/audit.mjs 583231             # by numeric ID
node tools/audit.mjs --version v1.0     # list everyone who signed v1.0
```

Or query a file directly via the GitHub API (with org-member credentials):

```bash
gh api repos/CLDMV/.cla-signatures/contents/signatures/github/v1.0/a4c/583231.json
```

## Signature record format

Each JSON file is a complete, self-contained record. Top-level fields:

- **`signer`** — Platform identity, immutable user ID, login at signing time, account metadata, the commit-author emails observed in the PR that triggered signing, plus signature-verification status of any signed commits.
- **`agreement`** — The CLA version, a SHA-256 of the agreement text at signing time, a commit-pinned URL to the exact text the contributor agreed to, and the verbatim comment body they posted.
- **`context`** — The consumer repo, PR number, PR title, head SHA, and full commit list — defining the contribution scope that triggered the signing.
- **`source`** — The PR comment ID and URL, plus GitHub-authoritative creation/update timestamps (so the record's "signed at" time is the comment's `created_at`, not the bot's clock).
- **`bot`** — Audit trail: which workflow ran, which version of the bot logic, which workflow run produced this record.
- **`signature_id`** — A SHA-256 hash of the record's canonical form, for tamper detection via `tools/verify.mjs`.

A signature is recorded once and never modified. CLA version bumps create a new file alongside any older signatures, never overwriting them.

## How a signature is added

1. A contributor opens a PR against any CLDMV repository.
2. The CLA bot enumerates the PR's commit authors. For each author, it queries this repository for an existing signature against the current CLA version.
3. If any author lacks a signature, the bot posts a comment on the PR with the required acceptance text.
4. The contributor replies with the exact required text on the PR.
5. The bot validates the reply, builds the signature record, and creates a new file here via the GitHub Contents API.
6. The signature applies org-wide — to every CLDMV repository, for every future PR — until the CLA's `major.minor` version is bumped.

## Versioning policy

See [VERSIONING.md](VERSIONING.md) for the full rule. In short: patch-level changes to a CLA's text (typos, formatting) never trigger re-signing; minor or major changes do.

## Why this repository exists

CLA acceptances need to survive forever, independent of any individual project's lifecycle. Keeping the records in a dedicated, central, private repository means:

- Signatures persist regardless of whether a consumer repo is squashed, rebased, archived, or renamed.
- Internal audit lives in one place, not scattered across PR threads on dozens of repos.
- A single signature covers every CLDMV repo, so a contributor signs once per CLA version, not once per PR.
- Contributor metadata (especially commit-author emails) stays out of public, searchable indexes.

## License

The audit and verification tooling in this repository is licensed under [Apache-2.0](LICENSE). The signature records themselves are legal artifacts of the agreements they document and are not separately licensed.
