# Examples 📋

Example workflow configurations for consuming the CLDMV org-level workflows. Copy the templates you need from [`individual-repo-workflows/`](individual-repo-workflows/) into your repo's `.github/workflows/` directory.

## 📖 Guides

- **[guides/WORKFLOW-SETUP-GUIDE.md](guides/WORKFLOW-SETUP-GUIDE.md)** — what each workflow does, which `package.json` scripts it requires, which secrets it needs, prerequisites. Start here when adding a workflow to a new repo.
- **[guides/DRY-RUN-GUIDE.md](guides/DRY-RUN-GUIDE.md)** — how to use dry-run mode on release and publish pipelines without making real changes.
- **[guides/UPDATE-MAJOR-VERSION-TAGS-GUIDE.md](guides/UPDATE-MAJOR-VERSION-TAGS-GUIDE.md)** — how the floating `vX` / `vX.Y` rolling tags are maintained.
- **[../docs/migration/v2-to-v3.md](../docs/migration/v2-to-v3.md)** — migration guide for consumers updating from v2 to v3.

## Template Catalog

Templates live in [`individual-repo-workflows/`](individual-repo-workflows/), grouped by purpose into five subfolders. Each one references the matching org workflow via `@v3`. Copy what you need; you don't need to adopt all of them.

### 🧪 [`core-cicd/`](individual-repo-workflows/core-cicd/) — Core CI/CD (most repos want all four)

| Template | Triggers | Calls | What it does |
|---|---|---|---|
| `ci.yml` | push, fork-PR | `workflow-ci.yml` | Build + test matrix; PR gate via status check on SHA |
| `release.yml` | push to non-default branch | `workflow-release.yml` | Detects `release:`/`release!:` commits → opens/updates a release PR |
| `publish.yml` | push to default branch | `workflow-publish.yml` | Publishes to NPM + GitHub Packages, creates GitHub release |
| `update-major-version-tags.yml` | `release: published` | `workflow-update-major-version-tags.yml` | Maintains rolling `vX` / `vX.Y` tags |

### 📋 [`release-companions/`](individual-repo-workflows/release-companions/) — Release-flow companions

| Template | Triggers | What it does |
|---|---|---|
| `sync-release-prs.yml` | PR merged to default | Re-evaluates every open release PR's version + changelog. Closes the silent-regression bug (P3.1/P3.2). |
| `tag-health.yml` | weekly Sunday cron + dispatch | Validates tags, fixes bot-signature drift, recreates orphaned tags. |
| `release-notify.yml` | `release: published` | Posts to configured Discord/Slack/generic webhook channels. |
| `master-commit-audit.yml` | push to default | Files a GitHub Issue if a master commit doesn't match the expected release-flow subject pattern. |

### 🔒 [`security/`](individual-repo-workflows/security/) — Security baseline (recommended for OSS repos)

| Template | Triggers | What it does |
|---|---|---|
| `codeql.yml` | push, PR, weekly cron | CodeQL SAST. |
| `dependency-review.yml` | PR | Flags new deps with known CVEs at PR-time. |
| `scorecard.yml` | weekly + branch_protection_rule | OpenSSF Scorecard, publishes to public scoreboard. |
| `cla.yml` | PR + issue_comment | Per-PR CLA signing for external contributors. Org members exempt. |

### 🤖 [`automation/`](individual-repo-workflows/automation/) — Automation

| Template | Triggers | What it does |
|---|---|---|
| `dependabot-auto-merge.yml` | PR by dependabot[bot] | Auto-approves + queues auto-merge for patch/minor bumps after CI. |
| `labeler.yml` | pull_request_target | Path-based PR labels (uses [labeler.default.yml](../.github/labeler.default.yml) unless overridden by `.github/labeler.yml`). |
| `welcome.yml` | first issue / PR | Friendly welcome with conditional links to CONTRIBUTING / CLA / COC. |
| `stale.yml` | daily cron | Marks/closes inactive issues + PRs. Defaults: 60+14 days issues, 30+7 days PRs. |
| `branch-retention.yml` | PR merged | Prunes most head branches; keeps last N of `release/*` and `hotfix/*`. |

### 📦 [`packaging-docs/`](individual-repo-workflows/packaging-docs/) — Packaging / docs (opt-in)

| Template | Triggers | What it does |
|---|---|---|
| `docker-publish.yml` | push to default + dispatch | Build + push image to GHCR. |
| `bundle-size.yml` | PR | Comments size delta of `dist/` (raw, gzip, brotli). For runtime libs. |
| `docs.yml` | push to default (paths-filtered) | Builds docs and publishes to `gh-pages`. |
| `sync-org-labels.yml` | manual / cron | Syncs `data/github-labels.json` across all repos in the org. (Org-admin repo only — most repos don't need this.) |

## How to use

1. Copy the template(s) you want into your repo's `.github/workflows/` directory. The category subfolders are organizational only — copy the `.yml` file itself, not the subfolder.
2. Update `package_name` (where present) to match your NPM package name — templates ship with the placeholder `@your-org/your-package`.
3. Configure required repo settings — see [guides/WORKFLOW-SETUP-GUIDE.md](guides/WORKFLOW-SETUP-GUIDE.md):
   - **Settings → Actions → "Require approval for outside collaborators"**
   - **Settings → Pull Requests → "Allow auto-merge"** (if adopting `dependabot-auto-merge.yml`)
   - **Branch protection** on master/main with required CI status check
4. Add the necessary secrets (most workflows need `CLDMV_BOT_APP_CLIENT_ID` + `CLDMV_BOT_APP_PRIVATE_KEY`; publish/release also need `NPM_TOKEN` if not using trusted publishers, GPG secrets if signing).
5. Commit and push — workflows run automatically when triggered.

## Customization

Most templates accept inputs to customize:

- **Node.js version**: default `lts/*`; override with `node_version`. CI/release default to a full matrix; publish defaults to a single max-version check (see [#2](https://github.com/CLDMV/.github/issues/2)).
- **Package manager**: default `npm`; can use `yarn`.
- **Commands**: customize test, lint, build, etc.
- **Skip options**: skip linting, performance tests, matrix testing, etc.
- **Publishing options**: control NPM vs GitHub Packages, GPG signing, SBOM generation.

See each org workflow's `workflow_call.inputs` for full input documentation.

## Version-bump auto-detection (release.yml)

The release workflow detects version-bump type from your commit messages:

- **`release!: message`** → **Major** (breaking)
- **`release: message`** → analyzes commit history since last tag:
  - `!` suffix or `BREAKING CHANGE` → **Major**
  - `feat:` commits → **Minor**
  - Only fixes / other → **Patch**

Override with `version_bump: "major" | "minor" | "patch"` in your workflow inputs.
