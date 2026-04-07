# 🛠️ Workflow Setup Guide

Quick reference for every example workflow: what it does, what `package.json` scripts it calls, what secrets it needs, and any other prerequisites.

---

## Workflows at a Glance

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| [CI Tests & Build](#-ci-tests--build) | `ci.yml` | push / PR to master | Tests, build, type check, coverage |
| [Create Release PR](#-create-release-pr) | `release.yml` | push to non-master | Opens version-bump PRs automatically |
| [Release and Publish](#-release-and-publish) | `publish.yml` | PR merged to master | Publishes to NPM / GitHub Packages |
| [Build and Publish Docker](#-build-and-publish-docker-image) | `docker-publish.yml` | push to master | Builds & pushes Docker image to GHCR |
| [Update Major Version Tags](#-update-major-version-tags) | `update-major-version-tags.yml` | release published / push to master | Keeps floating tags (`v1`, `v1.2`) in sync |

---

## 🧪 CI Tests & Build

**File:** `individual-repo-workflows/ci.yml`  
**Calls:** `CLDMV/.github/.github/workflows/workflow-ci.yml@v1`

### What it does

1. Runs your test suite and build across a Node.js version matrix
2. On a push that lands on the default branch → runs coverage and pushes a Shields.io-compatible badge JSON to the `badges` branch (signed bot commit)
3. On a pull request → injects a live coverage badge + breakdown table directly into the PR description body (no files committed)

### Required `package.json` scripts

| Script | When required | Default command |
|---|---|---|
| `test` | Always | `npm test` |
| `build:ci` | Always | `npm run build:ci` |
| `ci:coverage` | When `enable_coverage_badge` or `enable_coverage_pr_comment` is `true` (both default to `true`) | `npm run ci:coverage` |
| `test:types` | When `skip_type_check` is `false` (default) | `npm run test:types` |

> **Coverage output**: `ci:coverage` must produce a `coverage/coverage-summary.json` file (Istanbul / c8 / Vitest coverage reporter format). The path is configurable via `coverage_summary_path`.

### Required secrets

| Secret | Purpose | Required when |
|---|---|---|
| `NPM_TOKEN` | Install private packages | Always (if using private deps) |
| `CLDMV_BOT_APP_ID` | GitHub App authentication | Optional (falls back to `github-actions[bot]`) |
| `CLDMV_BOT_APP_PRIVATE_KEY` | GitHub App authentication | Optional |
| `CLDMV_BOT_NAME` | Signed bot commits to badges branch | `enable_coverage_badge: true` |
| `CLDMV_BOT_EMAIL` | Signed bot commits to badges branch | `enable_coverage_badge: true` |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | GPG-signed badge commits | `enable_coverage_badge: true` |
| `CLDMV_BOT_GPG_PASSPHRASE` | GPG-signed badge commits | `enable_coverage_badge: true` |

### Other prerequisites

- A `badges` branch must exist in the repository (create it as an orphan branch: `git checkout --orphan badges && git commit --allow-empty -m "init" && git push origin badges`)
- No `Dockerfile` or other special files needed

---

## 🚀 Create Release PR

**File:** `individual-repo-workflows/release.yml`  
**Calls:** `CLDMV/.github/.github/workflows/workflow-release.yml@v1`

### What it does

Watches for conventional commits on non-master branches and automatically opens a versioned release PR. Supports two modes:

- **Automatic** — detects `feat:`, `fix:`, `perf:`, `revert:`, `!` breaking-change commits and calculates the appropriate semver bump
- **Manual** — use `release:` commit prefix for patch/minor/major, or `release!:` to force a major bump

Bot commits are ignored to prevent infinite loops. Maintenance commits (`chore:`, `docs:`, `ci:`, `style:`, `test:`, `refactor:`) do not trigger releases but are included in generated changelogs.

### Required `package.json` scripts

| Script | When required |
|---|---|
| `test` | Always |
| `build:ci` | Always |

### Required secrets

| Secret | Purpose | Required when |
|---|---|---|
| `NPM_TOKEN` | Install private packages | Always (if using private deps) |
| `CLDMV_BOT_APP_ID` | GitHub App token (PR creation, enhanced permissions) | Strongly recommended |
| `CLDMV_BOT_APP_PRIVATE_KEY` | GitHub App token | Strongly recommended |
| `CLDMV_BOT_NAME` | GPG tagger identity | `use_gpg: true` |
| `CLDMV_BOT_EMAIL` | GPG tagger identity | `use_gpg: true` |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | GPG signing | `use_gpg: true` |
| `CLDMV_BOT_GPG_PASSPHRASE` | GPG signing | `use_gpg: true` |

### Other prerequisites

- `package.json` must have a valid `version` field (used as the base for the bump calculation)

---

## 📦 Release and Publish

**File:** `individual-repo-workflows/publish.yml`  
**Calls:** `CLDMV/.github/.github/workflows/workflow-publish.yml@v1`

### What it does

Fires when a release PR is merged into master. Re-runs tests and build, then:

1. Creates a GitHub Release with the generated changelog
2. Publishes to the NPM registry
3. Publishes to GitHub Packages

Both registries are enabled by default and can be toggled independently. Supports `dry_run` mode to validate the full pipeline without publishing anything.

### Required `package.json` scripts

| Script | When required |
|---|---|
| `test` | Always |
| `build:ci` | Always |

### Required secrets

| Secret | Purpose | Required when |
|---|---|---|
| `NPM_TOKEN` | Publish to NPM | `publish_to_npm: true` (default) |
| `CLDMV_BOT_APP_ID` | GitHub App token (release creation) | Strongly recommended |
| `CLDMV_BOT_APP_PRIVATE_KEY` | GitHub App token | Strongly recommended |
| `CLDMV_BOT_NAME` | GPG tagger identity | `use_gpg: true` |
| `CLDMV_BOT_EMAIL` | GPG tagger identity | `use_gpg: true` |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | GPG signing | `use_gpg: true` |
| `CLDMV_BOT_GPG_PASSPHRASE` | GPG signing | `use_gpg: true` |

### Other prerequisites

- `package.json` must have `name`, `version`, and `publishConfig` (or a valid registry config) for NPM publishing
- For GitHub Packages the package `name` must be scoped (e.g. `@your-org/package-name`)

---

## 🐳 Build and Publish Docker Image

**File:** `individual-repo-workflows/docker-publish.yml`  
**Calls:** `CLDMV/.github/.github/workflows/workflow-docker-publish.yml@v1`

### What it does

Triggers on every push to master (and manually). Runs an optional pre-publish command (default: `npm test`), then builds the Docker image, tags it with the version from `package.json`, and pushes it to GHCR (`ghcr.io`). Always pushes a `latest` tag in addition to the versioned tag.

### Required `package.json` scripts

| Script | When required |
|---|---|
| `test` | When `pre_publish_command` is `npm test` (default) — customizable to any shell command or empty string |

> The `pre_publish_command` is a freeform string — it does not have to be an npm script. Set it to `""` to skip entirely.

### Required secrets

| Secret | Purpose | Required when |
|---|---|---|
| `CLDMV_BOT_APP_ID` | GitHub App token (GHCR push auth) | Always |
| `CLDMV_BOT_APP_PRIVATE_KEY` | GitHub App token | Always |

### Other prerequisites

- A `Dockerfile` must exist at the repo root (path is configurable via `dockerfile` input)
- `package.json` must have a `name` field — the image name is derived from it automatically
- The GitHub App must have `packages: write` permission granted on the installation

---

## 🏷️ Update Major Version Tags

**File:** `individual-repo-workflows/update-major-version-tags.yml`  
**Calls:** `CLDMV/.github/.github/workflows/workflow-update-major-version-tags.yml@v1`

### What it does

Keeps floating semver tags in sync after a release. For every `vX.Y.Z` tag it finds, it creates or force-updates the corresponding `vX.Y` and `vX` floating tags pointing to the same commit. This is what lets callers pin to `@v1` or `@v1.12` and still receive non-breaking updates automatically.

Optionally creates/updates a `VERSION_TAGS.md` documentation file in the repo listing all managed tags.

### Required `package.json` scripts

_None._ This workflow does not install dependencies or run any scripts.

### Required secrets

| Secret | Purpose | Required when |
|---|---|---|
| `CLDMV_BOT_APP_ID` | GitHub App token (tag push auth) | Always |
| `CLDMV_BOT_APP_PRIVATE_KEY` | GitHub App token | Always |
| `CLDMV_BOT_NAME` | GPG tagger identity | `use_gpg: true` (default) |
| `CLDMV_BOT_EMAIL` | GPG tagger identity | `use_gpg: true` (default) |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | Sign the floating tags | `use_gpg: true` (default) |
| `CLDMV_BOT_GPG_PASSPHRASE` | Sign the floating tags | `use_gpg: true` (default) |

### Other prerequisites

- At least one `vX.Y.Z` tag must already exist in the repository — this workflow updates existing tags, it does not create the initial patch tag

---

## Secrets Summary

The table below shows which org/repo secrets each workflow uses. Map your org secrets to the names the workflow expects.

| Org secret name | ci | release | publish | docker | tags |
|---|:---:|:---:|:---:|:---:|:---:|
| `CLDMV_BOT_APP_ID` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `CLDMV_BOT_APP_PRIVATE_KEY` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `CLDMV_BOT_NAME` | ✓¹ | ✓² | ✓² | — | ✓ |
| `CLDMV_BOT_EMAIL` | ✓¹ | ✓² | ✓² | — | ✓ |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | ✓¹ | ✓² | ✓² | — | ✓ |
| `CLDMV_BOT_GPG_PASSPHRASE` | ✓¹ | ✓² | ✓² | — | ✓ |
| `NPM_TOKEN` | ✓ | ✓ | ✓ | — | — |

¹ Required when `enable_coverage_badge: true`  
² Required when `use_gpg: true`
