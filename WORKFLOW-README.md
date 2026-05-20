# CLDMV GitHub Organization Workflows 🚀

Shared GitHub Actions workflows for the CLDMV organization.

## 📋 Quick Start

1. **Copy example workflows** from [`examples/individual-repo-workflows/`](examples/individual-repo-workflows/) into your project's `.github/workflows/` directory.
2. **Update `package_name`** in each workflow to match your NPM package name.
3. **Customize inputs** as needed for your project.
4. **Commit and push** — the workflows run automatically when triggered.
5. **Configure fork-PR approval** — in **Settings → Actions → General → Fork pull request workflows from outside collaborators**, choose **"Require approval for all outside collaborators"** (or stricter). The example `ci.yml` runs on `push` for branches in this repo (no duplicates with PR sync) and on `pull_request` only for forks; the approval setting prevents fork CI from burning runner minutes until a maintainer clicks **"Approve and run"** on the PR's checks. See [GitHub's docs on approving workflow runs from public forks](https://docs.github.com/en/actions/managing-workflow-runs/approving-workflow-runs-from-public-forks).

## 🏗️ Architecture Overview

The repo has three layers:

- **Org entry points** — `.github/workflows/workflow-*.yml`. `workflow_call`
  workflows that individual repos reference (e.g. `workflow-ci.yml@v3`). They
  map inputs/secrets and delegate.
- **Reusable orchestrators** — `.github/workflows/reusable-*.yml`. Each bundles
  a set of jobs gated by `run_*` boolean inputs; the entry points call them.
- **Actions** — `.github/actions/`, grouped by technology layer. Almost all
  are Node (`using: node24`); see [`.github/actions/README.md`](.github/actions/README.md).

## 📂 Repository Structure

```
.github/
├── workflows/
│   ├── workflow-ci.yml                          # CI entry point
│   ├── workflow-release.yml                     # Release-PR entry point
│   ├── workflow-publish.yml                     # Publish entry point
│   ├── workflow-docker-publish.yml              # Docker publish entry point
│   ├── workflow-sync-org-labels.yml             # Org label sync entry point
│   ├── workflow-update-major-version-tags.yml
│   ├── workflow-sync-open-release-prs.yml       # Fan-out: refresh open release PRs on master merge (P3.2)
│   ├── reusable-build-and-test.yml              # orchestrators (run_* gated)
│   ├── reusable-release-management.yml
│   ├── reusable-publishing.yml
│   ├── reusable-tag-health.yml
│   ├── reusable-coverage-badge.yml
│   ├── reusable-coverage-pr-comment.yml
│   ├── reusable-codeql.yml                      # 🆕 v3: CodeQL SAST
│   ├── reusable-dependency-review.yml           # 🆕 v3: PR-time CVE diff
│   ├── reusable-container-scan.yml              # 🆕 v3: Trivy
│   ├── reusable-stale.yml                       # 🆕 v3: roll-our-own stale sweep
│   ├── reusable-dependabot-auto-merge.yml       # 🆕 v3: Dependabot auto-merge
│   ├── reusable-pr-labeler.yml                  # 🆕 v3: path-based PR labels
│   ├── reusable-welcome.yml                     # 🆕 v3: first-time contributor welcome
│   ├── reusable-bundle-size.yml                 # 🆕 v3: bundle-size diff on PRs
│   ├── reusable-docs-publish.yml                # 🆕 v3: gh-pages docs publisher
│   ├── reusable-release-notifier.yml            # 🆕 v3: Discord/Slack/webhook
│   ├── reusable-branch-retention.yml            # 🆕 v3: prune merged branches
│   └── reusable-cla.yml                         # 🆕 v3: CLA bot
└── actions/                                     # reusable actions (Node)
    ├── common/  git/  github/  npm/  node/  docker/  coverage/  workflows/
    └── community/                               # 🆕 v3: CLA, release notifier
data/github-labels.json                          # org label catalog (5 new in v3)
docs/conventions/branch-naming.md                # 🆕 v3: branch naming convention
scripts/setup-org-rulesets.mjs                   # 🆕 v3: installer for naming Ruleset
CLA.md                                           # 🆕 v3: contributor license agreement
examples/
└── individual-repo-workflows/                   # copy-paste templates for consumers
```

## 🔧 Available Workflows

### CI Workflow (`workflow-ci.yml`)

- **Purpose**: CI testing and building for NPM packages.
- **Triggers**: Push to any branch, PR to master/main.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-ci.yml@v3`

### Release Workflow (`workflow-release.yml`)

- **Purpose**: Creates release PRs from release commits, with changelog generation.
- **Triggers**: Push to non-master/main branches (when you push `release:` or `release!:` commits).
- **Dry Run Support**: Validate the entire release process without making changes.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-release.yml@v3`

#### 🧪 Dry Run Mode

The release workflow validates the entire release process without making changes:

**Validates**: release commit detection, version calculation/bumping, build and
test, changelog generation, and all prerequisites for PR creation.

**Skips**: package.json version updates, git commit creation, pull request creation.

### Publish Workflow (`workflow-publish.yml`)

- **Purpose**: Publishes packages to NPM / GitHub Packages and creates GitHub releases.
- **Triggers**: PR closed on master (when release PRs are merged).
- **Dry Run Support**: Validate the entire publishing pipeline without publishing.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-publish.yml@v3`

#### 🧪 Dry Run Mode

**Validates**: build and test, NPM and GitHub Packages authentication/commands,
GitHub release prerequisites, package version and metadata.

**Skips**: actual NPM/GitHub Packages publishing, GitHub release creation, git
tag creation.

### Update Major Version Tags Workflow (`workflow-update-major-version-tags.yml`)

- **Purpose**: Maintains rolling major/minor version tags (e.g. `v1`, `v1.2`).
- **Triggers**: New release published or semantic version tag pushed.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-update-major-version-tags.yml@v3`

### Tag Health Workflow (`reusable-tag-health.yml`)

- **Purpose**: Tag maintenance and health monitoring for Git repositories.
- **Triggers**: Manual dispatch, tag push events, scheduled maintenance.
- **Usage**: `CLDMV/.github/.github/workflows/reusable-tag-health.yml@v3`

#### 🏥 Health Check Operations

1. **🔍 Validation** — ensures a pushed tag is reachable from main/master.
2. **🏷️ Bot Signature Fixes** — recreates tags with incorrect author signatures.
3. **✍️ Unsigned Tag Fixes** — adds GPG signatures to unsigned tags.
4. **🔗 Orphaned Release Fixes** — recreates missing tags for GitHub releases.
5. **🚨 Orphaned Tag Fixes** — relocates tags pointing at orphaned commits.
6. **📈 Major/Minor Updates** — maintains rolling version references.
7. **🔄 Token Management** — coordinates App-token authentication throughout.

## 🆕 v3 Workflows

Added to v3. Each has a copy-paste template in `examples/individual-repo-workflows/`.

| Workflow | Purpose |
|---|---|
| `reusable-codeql.yml` | GitHub static analysis (SAST). Push + PR + weekly schedule. |
| `reusable-dependency-review.yml` | At PR-time, flag new deps with CVEs from GitHub Advisory DB. |
| `reusable-container-scan.yml` | Trivy vulnerability scan; plugs into docker-publish flow. |
| `reusable-stale.yml` | Daily auto-stale/auto-close for inactive issues and PRs. Roll-our-own (no `actions/stale` dep). |
| `reusable-dependabot-auto-merge.yml` | Approve + auto-merge patch/minor Dependabot PRs after CI passes. |
| `reusable-pr-labeler.yml` | Path-based PR labels feeding the existing label catalog. |
| `reusable-welcome.yml` | Friendly first-PR / first-issue welcome with conditional links to CONTRIBUTING / CLA / COC. |
| `reusable-bundle-size.yml` | Diff `dist/` sizes on PRs; comment with delta table. For runtime libs. |
| `reusable-docs-publish.yml` | Build docs and push to `gh-pages` branch. |
| `reusable-release-notifier.yml` | On `release:published`, fan out to Discord / Slack / generic webhook channels. Per-repo channel config merged with org default. |
| `reusable-branch-retention.yml` | On PR merge: prune most head branches; keep last N of `release/*` / `hotfix/*`. |
| `reusable-cla.yml` | Per-PR CLA signing via "I agree" comment. Org members exempt. |
| `workflow-sync-open-release-prs.yml` | When any PR merges to master, fan-out and re-update every open release PR's version + changelog. |

## 🏗️ Orchestrator Pattern

Each `reusable-*.yml` workflow exposes `run_*` boolean inputs; an entry point
enables only the jobs it needs. Flags include `run_build_and_test`,
`run_detect_release`, `run_create_release_pr`, `run_create_release`,
`run_publish_npm`, `run_publish_github_packages`, `run_update_major_version_tags`,
`run_detect_repo_config`, and `run_unified_tag_health`.

The jobs themselves delegate to actions under `.github/actions/`
(`common/`, `git/`, `github/`, `npm/`, `node/`, `docker/`, `coverage/`,
`community/`, `workflows/`).

## 📖 Documentation

- **[examples/](examples/)** — usage examples and setup guides.
- **[.github/actions/README.md](.github/actions/README.md)** — how the actions are structured.
- **[.github/instructions/repo-conventions.instructions.md](.github/instructions/repo-conventions.instructions.md)** — tag, signing, API-version, and secret-naming rules.

## 🤝 Contributing

1. Keep `workflow-*.yml` entry points thin; put job logic in `reusable-*.yml`
   orchestrators and `.github/actions/` actions.
2. Prefer Node (`using: node24`) actions; see the actions README.
3. Test changes with the example workflows before org-wide rollout.
4. Reference internal actions/workflows by version tag (`@v3`), never `@master`.

## 🆘 Support

- Check [examples/](examples/) for usage patterns.
- Review [.github/actions/README.md](.github/actions/README.md) for the action layout.
- Open an issue in this repository.
