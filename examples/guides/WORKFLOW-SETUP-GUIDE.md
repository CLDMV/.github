# 🛠️ Workflow Setup Guide

Per-template setup reference for every example workflow under [`../individual-repo-workflows/`](../individual-repo-workflows/): what it does, what `package.json` scripts it calls, what secrets it needs, and any other prerequisites. The same five-category grouping as [`../README.md`](../README.md).

---

## Workflows at a Glance

| Category | Workflow | File | Trigger | Purpose |
|---|---|---|---|---|
| Core CI/CD | [CI Tests & Build](#-ci-tests--build) | `core-cicd/ci.yml` | push / fork-PR | Test matrix + build; PR gate |
| Core CI/CD | [Create Release PR](#-create-release-pr) | `core-cicd/release.yml` | push to non-default | Opens versioned release PRs |
| Core CI/CD | [Release and Publish](#-release-and-publish) | `core-cicd/publish.yml` | push to master/main | Publishes to NPM / GitHub Packages |
| Core CI/CD | [Update Major Version Tags](#-update-major-version-tags) | `core-cicd/update-major-version-tags.yml` | release published | Maintains `vX` / `vX.Y` floating tags |
| Release flow v4 | [Next Release](#-next-release-v4) | `release-flow-v4/next-release.yml` | push to `next` | Refreshes persistent `next → master` release PR |
| Release flow v4 | [Hotfixes Release](#-hotfixes-release-v4) | `release-flow-v4/hotfixes-release.yml` | push to `hotfixes` | Refreshes persistent `hotfixes → master` release PR |
| Release flow v4 | [Next/Hotfixes Reset](#-nexthotfixes-reset-v4) | `release-flow-v4/next-reset.yml` | push to `master` (release commit) | Re-syncs integration branches after a release |
| Release flow v4 | [Hotfix PR Redirector](#-hotfix-pr-redirector-v4) | `release-flow-v4/hotfix-redirector.yml` | PR opened | Retargets `hotfix/*` / `security/*` PRs onto `hotfixes` |
| Release flow v4 | [PR Title Normalizer](#%EF%B8%8F-pr-title-normalizer) | `release-flow-v4/pr-title-normalizer.yml` | PR opened / synchronize | Normalizes PR titles to conventional-commit shape |
| Release flow v4 | [v4 Bootstrap](#-v4-bootstrap) | `release-flow-v4/v4-bootstrap.yml` | manual dispatch | Creates `next` + `hotfixes`; configures repo for v4 |
| Release companions | [Tag Health](#-tag-health) | `release-companions/tag-health.yml` | weekly cron + dispatch | Validates / repairs tags |
| Release companions | [Release Notifier](#-release-notifier) | `release-companions/release-notify.yml` | release published | Notifies Discord / Slack / webhooks |
| Release companions | [Master Commit Audit](#-master-commit-audit) | `release-companions/master-commit-audit.yml` | push to default | Files Issues on subject-line drift |
| Security | [CodeQL](#-codeql) | `security/codeql.yml` | push / PR / weekly cron | SAST via CodeQL |
| Security | [Dependency Review](#-dependency-review) | `security/dependency-review.yml` | PR | Blocks PRs with high-severity new deps |
| Security | [OpenSSF Scorecard](#-openssf-scorecard) | `security/scorecard.yml` | weekly + dispatch | Publishes OSSF Scorecard score |
| Security | [CLA Bot](#-cla-bot) | `security/cla.yml` | PR + issue_comment | Requires CLA from non-members |
| Automation | [Dependabot Auto-Merge](#-dependabot-auto-merge) | `automation/dependabot-auto-merge.yml` | PR by dependabot[bot] | Auto-merges patch/minor bumps |
| Automation | [Labeler](#-labeler) | `automation/labeler.yml` | pull_request_target | Path-based PR labels |
| Automation | [Welcome](#-welcome) | `automation/welcome.yml` | first issue / PR | Welcome comments |
| Automation | [Stale](#-stale) | `automation/stale.yml` | daily cron | Marks/closes inactive issues + PRs |
| Automation | [Branch Retention](#-branch-retention) | `automation/branch-retention.yml` | PR merged | Prunes head branches with retention |
| Packaging/docs | [Docker Publish](#-docker-publish) | `packaging-docs/docker-publish.yml` | push to default + dispatch | Builds + pushes image to GHCR |
| Packaging/docs | [Bundle Size](#-bundle-size) | `packaging-docs/bundle-size.yml` | PR | Comments `dist/` size delta |
| Packaging/docs | [Docs Publish](#-docs-publish) | `packaging-docs/docs.yml` | push to default (filtered) | Publishes docs to `gh-pages` |
| Packaging/docs | [Sync Org Labels](#-sync-org-labels) | `packaging-docs/sync-org-labels.yml` | manual / weekly cron | Syncs labels across org repos |

---

## 🧪 Core CI/CD

### 🧪 CI Tests & Build

**File:** `core-cicd/ci.yml` &nbsp;·&nbsp; **Calls:** `workflow-ci.yml@v4`

Runs your test suite and build across a Node.js version matrix. On a push that lands on the default branch → runs coverage and pushes a Shields.io-compatible badge JSON to the `badges` branch (signed bot commit). On a pull request → injects a live coverage badge + breakdown table directly into the PR description body (no files committed).

**Required `package.json` scripts**

| Script | When required | Default command |
|---|---|---|
| `test` | Always | `npm test` |
| `build:ci` | Always | `npm run build:ci` |
| `ci:coverage` | When `enable_coverage_badge` / `enable_coverage_pr_comment` is `true` (both default `true`) | `npm run ci:coverage` |
| `test:types` | When `skip_type_check` is `false` (default) | `npm run test:types` |

`ci:coverage` must produce a `coverage/coverage-summary.json` (Istanbul / c8 / Vitest reporter format). Path is configurable via `coverage_summary_path`.

**Required secrets** — see [Secrets Summary](#secrets-summary). `NPM_TOKEN` for private deps; bot credentials optional but enable proper attribution; coverage-badge secrets required only when `enable_coverage_badge: true`.

**Prereqs** — A `badges` branch must exist for coverage publishing (orphan: `git checkout --orphan badges && git commit --allow-empty -m "init" && git push origin badges`).

---

### 🚀 Create Release PR

**File:** `core-cicd/release.yml` &nbsp;·&nbsp; **Calls:** `workflow-release.yml@v4`

Watches for conventional commits on non-master branches and automatically opens a versioned release PR. Two modes: **automatic** detects `feat:`/`fix:`/`perf:`/`revert:`/`!` breaking commits and calculates the semver bump; **manual** uses `release:` prefix for patch/minor/major or `release!:` to force a major bump. Bot commits are ignored to prevent loops. Maintenance commits (`chore:`, `docs:`, `ci:`, …) don't trigger releases but are included in changelogs.

**Required `package.json` scripts** — `test`, `build:ci`.

**Required secrets** — `NPM_TOKEN`, plus bot App credentials. GPG signing secrets required when `use_gpg: true`.

**Prereqs** — `package.json` must have a valid `version` field (used as base for the bump calculation).

---

### 📦 Release and Publish

**File:** `core-cicd/publish.yml` &nbsp;·&nbsp; **Calls:** `workflow-publish.yml@v4`

Fires when a release PR is merged into master. Re-runs tests and build, then: creates a GitHub Release with the generated changelog, publishes to the NPM registry, publishes to GitHub Packages. Both registries are toggleable independently via `publish_to_npm` / `publish_to_github_packages`. Supports `dry_run` to validate the full pipeline without publishing. See [DRY-RUN-GUIDE.md](DRY-RUN-GUIDE.md).

**Required `package.json` scripts** — `test`, `build:ci`. Set `min_node_version: ""` (empty) for a single max-version check; provide a value (e.g. `"20"`) to opt into the test matrix.

**Required secrets** — `NPM_TOKEN` (when `publish_to_npm: true`), bot App credentials, GPG signing secrets when `use_gpg: true`.

**Prereqs** — `package.json` must have `name`, `version`, and a valid `publishConfig`. For GitHub Packages the `name` must be scoped (e.g. `@your-org/your-package`).

---

### 🏷️ Update Major Version Tags

**File:** `core-cicd/update-major-version-tags.yml` &nbsp;·&nbsp; **Calls:** `workflow-update-major-version-tags.yml@v4`

After a release, creates or force-updates the floating `vX.Y` and `vX` tags pointing at the new patch tag. Optionally maintains a `VERSION_TAGS.md` file documenting all managed tags. Full details in [UPDATE-MAJOR-VERSION-TAGS-GUIDE.md](UPDATE-MAJOR-VERSION-TAGS-GUIDE.md).

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials, plus GPG signing secrets (default `use_gpg: true`).

**Prereqs** — at least one `vX.Y.Z` tag must exist — this workflow updates floating tags, it doesn't create the initial patch tag.

---

## 🔀 Release flow v4

The v4 staging-branch model. **Adopt as a set** — these workflows depend on each other. After installing, complete the cutover via [docs/migration/v3-to-v4.md](../../docs/migration/v3-to-v4.md): import the rulesets, add the bot App to bypass on `next`/`hotfixes`, retire any existing v3 per-PR release flow.

### 🚀 Next Release (v4)

**File:** `release-flow-v4/next-release.yml` &nbsp;·&nbsp; **Calls:** `create-release-pr@v4` / `update-release-pr@v4`

Fires on every push to `next` (contributor PR squash-merges land here). Resolves or creates the persistent `next → master` release PR and refreshes its version + changelog from the `master..next` range. The version bump rides as a `chore: bump version` commit on `next` and is carried through the squash on merge.

**Required `package.json` scripts** — `test`, `build:ci` (substitute stub commands like `echo '✓ no build step'` for a meta package with no build).

**Required secrets** — bot App credentials.

**Prereqs** — `next` branch exists (run `v4-bootstrap.yml` first); ruleset on `next` with bot in bypass; **edit the `package-name` + `build-command` placeholders** in this file.

---

### 🚑 Hotfixes Release (v4)

**File:** `release-flow-v4/hotfixes-release.yml` &nbsp;·&nbsp; **Calls:** `create-release-pr@v4` / `update-release-pr@v4`

Mirror of `next-release.yml` but for the `hotfixes` integration branch. Patches the current release independently of whatever is pending on `next`.

**Required `package.json` scripts** — same as `next-release.yml`.

**Required secrets** — bot App credentials.

**Prereqs** — `hotfixes` branch exists; ruleset on `hotfixes` with bot in bypass; **edit the `package-name` + `build-command` placeholders** in this file.

---

### ♻️ Next/Hotfixes Reset (v4)

**File:** `release-flow-v4/next-reset.yml` &nbsp;·&nbsp; **Calls:** `force-reset-branch@v4` / `merge-master-into-branch@v4`

After a release lands on master, re-syncs the integration branches. `hotfixes` is always force-reset to master HEAD; `next` is force-reset on a normal release, or master-merged-into-`next` on a hotfix release (preserves in-flight feature work). Uses the **REST API** because a bot-App `git push` is rejected by the ruleset even with bypass. Self-healing — recreates a branch that went missing.

A `wait-for-tags` job gates the reset on the released major tag (`@vN`) rolling forward, so the sync job can't run the previous release's action code.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials (App must have repo `administration: write` for branch creation).

**Prereqs** — none beyond the bot bypass on `next`/`hotfixes`.

---

### 🔀 Hotfix PR Redirector (v4)

**File:** `release-flow-v4/hotfix-redirector.yml` &nbsp;·&nbsp; **Calls:** `redirect-hotfix-pr@v4`

When a PR opens from a `hotfix/*` or `security/*` head branch, retargets it onto the `hotfixes` integration branch. API-only (`pull_request_target` without checkout — safe).

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials.

**Prereqs** — `hotfixes` branch exists.

---

### 🏷️ PR Title Normalizer

**File:** `release-flow-v4/pr-title-normalizer.yml` &nbsp;·&nbsp; **Calls:** `normalize-pr-title@v4`

Normalizes contributor PR titles to Conventional Commits format (the release flow expects this shape). API-only via `pull_request_target` — no checkout. Useful even outside v4 (backportable to v3 repos).

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials (falls back to `GITHUB_TOKEN`).

**Prereqs** — none.

---

### 🚀 v4 Bootstrap

**File:** `release-flow-v4/v4-bootstrap.yml` &nbsp;·&nbsp; **Calls:** (inline `gh api`)

One-shot setup, run once per repo via the Actions tab. Creates `next` + `hotfixes` from master HEAD, enables "Allow auto-merge", and disables "Automatically delete head branches" (next/hotfixes must survive PR merges — they're the persistent release-PR heads). Idempotent. Defaults `dry_run: true`.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials (App needs `administration: write` for the auto-merge / branch-delete toggle).

**Prereqs** — master branch with at least one commit. Doesn't apply branch protection — import the rulesets by hand after running; the run summary links them.

---

## 📋 Release-flow companions

### 🏥 Tag Health

**File:** `release-companions/tag-health.yml` &nbsp;·&nbsp; **Calls:** `reusable-tag-health.yml@v4`

Weekly Sunday 04:04 UTC sweep that runs the unified tag-health pipeline: validation, bot-signature fixes, unsigned-tag fixes, orphaned-release recovery, orphaned-tag relocation, and rolling-tag maintenance. Manual dispatch supported.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials, plus GPG signing secrets (default `use_gpg: true`).

**Key inputs** — `create_documentation` (update `VERSION_TAGS.md` if rolling tags moved), `use_gpg` (default `true`).

---

### 📣 Release Notifier

**File:** `release-companions/release-notify.yml` &nbsp;·&nbsp; **Calls:** `reusable-release-notifier.yml@v4`

Fires on `release: published`. Reads per-repo channel config from `.github/release-notifier.yml` (merged with org defaults) and fans out to configured Discord / Slack / generic webhooks.

**Required `package.json` scripts** — none.

**Required secrets** — channel-specific webhook secrets (e.g. `DISCORD_<REPO>_WEBHOOK`) referenced by the per-repo config file.

**Prereqs** — `.github/release-notifier.yml` in the repo defining the channels to notify.

---

### 🕵️ Master Commit Audit

**File:** `release-companions/master-commit-audit.yml` &nbsp;·&nbsp; **Calls:** the `audit-commit-subject@v4` action directly

After every push to default, validates the commit subject against the expected release-flow pattern and files a GitHub Issue if it doesn't match. Catches manual master commits and release-flow regressions.

**Required `package.json` scripts** — none.

**Required secrets** — none beyond `GITHUB_TOKEN` (automatically provided).

**Key inputs** — `allowed_patterns` (regex list — customize per repo), `issue_labels` (default `bot:audit,priority:high`), `issue_assignee` (optional).

---

## 🔒 Security baseline

### 🔍 CodeQL

**File:** `security/codeql.yml` &nbsp;·&nbsp; **Calls:** `reusable-codeql.yml@v4`

CodeQL SAST. Runs on push to master/main, on PRs against master/main, and weekly Monday 14:37 UTC. SARIF results upload to the repo's Security tab.

**Required `package.json` scripts** — none.

**Required secrets** — none.

**Key inputs** — `languages` (default `javascript-typescript` — supply a CSV like `python,go`), `queries` (override to `security-extended,security-and-quality` for deeper analysis), `paths_ignore`, `config_file`.

---

### 🛡️ Dependency Review

**File:** `security/dependency-review.yml` &nbsp;·&nbsp; **Calls:** `reusable-dependency-review.yml@v4`

On every PR against master/main, diffs the dependency manifest and blocks the PR if new deps exceed the configured severity floor. Backed by the GitHub Advisory Database.

**Required `package.json` scripts** — none.

**Required secrets** — none.

**Key inputs** — `fail_on_severity` (default `moderate`; pick `low`/`moderate`/`high`/`critical`), `deny_licenses` (optional CSV blocking license types like `GPL-3.0`).

---

### 🏅 OpenSSF Scorecard

**File:** `security/scorecard.yml` &nbsp;·&nbsp; **Calls:** `ossf/scorecard-action@v3.4.0` + `github/codeql-action/upload-sarif@v3`

Runs the OpenSSF Scorecard on `branch_protection_rule` events, weekly Monday 07:32 UTC, on push to default, and manually. Results publish to the public scoreboard at `securityscorecards.dev`.

**Required `package.json` scripts** — none.

**Required secrets** — none for public repos. Private repos need a `SCORECARD_TOKEN` PAT with read access.

**Prereqs** — public repo (or set `publish_results: false` and configure `SCORECARD_TOKEN`).

---

### ✍️ CLA Bot

**File:** `security/cla.yml` &nbsp;·&nbsp; **Calls:** `reusable-cla.yml@v4`

On every PR (including from forks), checks whether each commit author has signed the CLA. Non-members can sign by commenting `I have read the CLA Document and I hereby sign the CLA` on the PR. Org members and configured bots are exempt.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials, plus `CLDMV_BOT_NAME` / `CLDMV_BOT_EMAIL` for signed commit attribution on the CLA store.

**Prereqs** — the bot App must have Organization → Members: Read permission (to detect org members for exemption). `CLA.md` in the repo (or referenced from an org-wide repo).

**Key inputs** — `cla_version` (default `1.0.0`; bump when the CLA text changes to invalidate prior signatures).

---

## 🤖 Automation

### 🔀 Dependabot Auto-Merge

**File:** `automation/dependabot-auto-merge.yml` &nbsp;·&nbsp; **Calls:** `reusable-dependabot-auto-merge.yml@v4`

Auto-approves and queues auto-merge for patch/minor Dependabot bumps once CI passes. Major bumps are left for a human.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials.

**Prereqs** — **Settings → Pull Requests → "Allow auto-merge"** must be ON. Branch protection on master/main must require CI status checks.

**Key inputs** — `bump_types` (default `patch,minor`), `merge_method` (default `squash`), `also_for_actors` (extend to Renovate or other bots).

---

### 🏷️ Labeler

**File:** `automation/labeler.yml` &nbsp;·&nbsp; **Calls:** `reusable-pr-labeler.yml@v4`

Path-based PR labels. Uses the org-wide [`labeler.default.yml`](../../.github/labeler.default.yml) unless the consumer repo provides a `.github/labeler.yml` to override.

**Required `package.json` scripts** — none.

**Required secrets** — none required. **Optional**: pass `BOT_APP_CLIENT_ID` / `BOT_APP_PRIVATE_KEY` to attribute the label changes to your bot App instead of `github-actions[bot]`. Falls back to `GITHUB_TOKEN` if unset.

**Prereqs** — none. Optional `.github/labeler.yml` in the repo for per-repo path patterns.

> ⚠️ The `pull_request_target` trigger runs in the context of the base branch. The reusable does NOT check out PR code — labeling is API-only.

---

### 👋 Welcome

**File:** `automation/welcome.yml` &nbsp;·&nbsp; **Calls:** `reusable-welcome.yml@v4`

Posts a friendly welcome comment to first-time contributors on their first issue and first PR. Comment content conditionally links to CONTRIBUTING / CLA / COC based on which files exist in the repo.

**Required `package.json` scripts** — none.

**Required secrets** — none required. **Optional**: pass `BOT_APP_CLIENT_ID` / `BOT_APP_PRIVATE_KEY` to post the welcome comment as your bot App instead of `github-actions[bot]`. Falls back to `GITHUB_TOKEN` if unset.

**Prereqs** — none.

---

### 💤 Stale

**File:** `automation/stale.yml` &nbsp;·&nbsp; **Calls:** `reusable-stale.yml@v4`

Daily 05:13 UTC sweep that marks inactive issues / PRs as stale and closes them after additional inactivity. Reasonable defaults; first-run on a backlog should use `dry_run: true` to preview.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials.

**Key inputs** — `dry_run` (preview mode for first run on a backlog), `days_before_issue_stale` (default `60`), `days_before_issue_close` (default `14`), `days_before_pr_stale` (default `30`), `days_before_pr_close` (default `7`).

---

### 🌿 Branch Retention

**File:** `automation/branch-retention.yml` &nbsp;·&nbsp; **Calls:** `reusable-branch-retention.yml@v4`

On every PR merge to default, deletes most head branches immediately and keeps the last N of `release/*` (default 5) and `hotfix/*` (default 3). `master`, `main`, `badges`, `gh-pages` are always exempt. Backs the branch naming convention in [`docs/conventions/branch-naming.md`](../../docs/conventions/branch-naming.md).

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials.

**Prereqs** — none.

---

## 📦 Packaging / docs

### 🐳 Docker Publish

**File:** `packaging-docs/docker-publish.yml` &nbsp;·&nbsp; **Calls:** `workflow-docker-publish.yml@v4`

Builds and pushes a Docker image to GHCR on every push to default (and manual dispatch). Runs an optional pre-publish command (default `npm test`), tags with the version from `package.json`, and also pushes a `latest` tag.

**Required `package.json` scripts** — `test` when `pre_publish_command` is `npm test` (default); `pre_publish_command` is freeform — set to `""` to skip.

**Required secrets** — bot App credentials.

**Prereqs** — `Dockerfile` at repo root (path configurable via `dockerfile`). `package.json` must have a `name` field — image name is derived from it. The bot App needs `packages: write` permission.

**Key inputs** — `image_namespace` (default `cldmv`), `pre_publish_command`, `dockerfile` path.

---

### 📊 Bundle Size

**File:** `packaging-docs/bundle-size.yml` &nbsp;·&nbsp; **Calls:** `reusable-bundle-size.yml@v4`

Runtime-library helper: on every PR against default, builds the package and posts a comment with raw / gzip / brotli size deltas against the base branch. Adopt only for repos that ship a runtime bundle.

**Required `package.json` scripts** — `build` (default `npm run build`; configurable via `build_command`).

**Required secrets** — none required. **Optional**: pass `BOT_APP_CLIENT_ID` / `BOT_APP_PRIVATE_KEY` to post the size-diff comment as your bot App instead of `github-actions[bot]`. Falls back to `GITHUB_TOKEN` if unset. (Fork PRs can't access org secrets, so attribution only applies to same-repo PRs there.)

**Prereqs** — buildable distributable in `dist/` (or `dist_paths`).

**Key inputs** — `build_command`, `dist_paths` (default `dist/**`), `warning_pct`, `warning_bytes`, `comment_mode`.

---

### 📚 Docs Publish

**File:** `packaging-docs/docs.yml` &nbsp;·&nbsp; **Calls:** `reusable-docs-publish.yml@v4`

On pushes to default touching `docs/`, source, or markdown files, builds docs and pushes the output to the `gh-pages` branch as a signed bot commit.

**Required `package.json` scripts** — `docs:build` (default `npm run docs:build`; configurable via `build_command`).

**Required secrets** — bot App credentials, plus `CLDMV_BOT_NAME` / `CLDMV_BOT_EMAIL` for signed commits.

**Prereqs** — `gh-pages` branch must exist (orphan: `git checkout --orphan gh-pages && git commit --allow-empty -m "init" && git push origin gh-pages`). Build output must land at `output_dir` (default `docs/dist`).

**Key inputs** — `build_command`, `output_dir`, `cname` (custom domain — sets the `CNAME` file).

---

### 🏷️ Sync Org Labels

**File:** `packaging-docs/sync-org-labels.yml` &nbsp;·&nbsp; **Calls:** `workflow-sync-org-labels.yml@v4`

Reads `data/github-labels.json` from the public org repo and applies the catalog to every CLDMV repo. Weekly Monday 06:00 UTC + manual dispatch with `dry_run` support.

> Place this template in a **PRIVATE** repo (e.g. `CLDMV/org-config`). The reusable workflow lives in this public repo, but execution should happen in a private repo so the run logs — including repo names — stay out of the public Actions stream.

**Required `package.json` scripts** — none.

**Required secrets** — bot App credentials (must have org-wide repo:write).

**Prereqs** — Org admin only — most repos don't need this. Run `dry_run: true` first to verify the planned changes.

**Key inputs** — `dry_run` (preview without applying), `debug`.

---

## Secrets Summary

The table below maps each template to the org/repo secrets it actually references. The bot App credentials (`CLDMV_BOT_APP_CLIENT_ID` / `CLDMV_BOT_APP_PRIVATE_KEY`) are mapped to `BOT_APP_CLIENT_ID` / `BOT_APP_PRIVATE_KEY` inside the reusable via `secrets:` inheritance — the consumer always references the `CLDMV_*` name in their workflow's `secrets:` block.

| Org secret name | ci | release | publish | sync-rel-prs | tag-health | docker | cla | docs | dependabot | stale | branch-ret. | sync-labels |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `CLDMV_BOT_APP_CLIENT_ID` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `CLDMV_BOT_APP_PRIVATE_KEY` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `CLDMV_BOT_NAME` | ✓¹ | ✓² | ✓² | — | ✓ | — | ✓ | ✓ | — | — | — | — |
| `CLDMV_BOT_EMAIL` | ✓¹ | ✓² | ✓² | — | ✓ | — | ✓ | ✓ | — | — | — | — |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | ✓¹ | ✓² | ✓² | — | ✓ | — | — | — | — | — | — | — |
| `CLDMV_BOT_GPG_PASSPHRASE` | ✓¹ | ✓² | ✓² | — | ✓ | — | — | — | — | — | — | — |
| `NPM_TOKEN` | ✓³ | ✓³ | ✓ | — | — | — | — | — | — | — | — | — |

¹ Required when `enable_coverage_badge: true` (the default — uncheck to skip)
² Required when `use_gpg: true`
³ Required when installing private deps from npm

Templates not in this table (`codeql.yml`, `dependency-review.yml`, `scorecard.yml`, `labeler.yml`, `welcome.yml`, `bundle-size.yml`, `master-commit-audit.yml`, `release-notify.yml`) need no secrets beyond the automatic `GITHUB_TOKEN`.

**Optional bot-attribution secrets:** `labeler.yml`, `welcome.yml`, `bundle-size.yml`, and the coverage-PR-comment leg of `ci.yml` accept `CLDMV_BOT_APP_CLIENT_ID` / `CLDMV_BOT_APP_PRIVATE_KEY` to attribute their PR mutations (labels, comments, PR-body edits) to your bot App instead of `github-actions[bot]`. Falls back to `GITHUB_TOKEN` if unset, so they work without these secrets — just with different attribution.

`release-notify.yml` additionally references per-channel webhook secrets you define yourself (e.g. `DISCORD_<REPO>_WEBHOOK`).

---

## Common prerequisites

These come up across multiple workflows — set them once per repo:

- **Branch protection** on `master`/`main` with required CI status check (`✅ Required PR Check` from `ci.yml`).
- **Settings → Actions → "Require approval for outside collaborators"** to control fork-PR runs.
- **Settings → Pull Requests → "Allow auto-merge"** if adopting `dependabot-auto-merge.yml`.
- **`badges` branch** (orphan, empty initial commit) — required by `ci.yml` coverage publishing.
- **`gh-pages` branch** (orphan, empty initial commit) — required by `docs.yml`.
- **`CLA.md`** at repo root (or referenced from org repo) — required by `cla.yml`.
- **`Dockerfile`** at repo root — required by `docker-publish.yml`.
- **`.github/release-notifier.yml`** — required by `release-notify.yml` to define channels.
- **Bot App permissions** — Contents: write, Pull-requests: write, Issues: write, Packages: write (for Docker), Org → Members: read (for CLA).
