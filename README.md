# CLDMV GitHub Organization Workflows 🚀

Shared GitHub Actions workflows for the CLDMV organization.

## 📋 Quick Start

These workflows ship a complete CI / release / publish pipeline tuned for the **v4 staging-branch release flow** — feature PRs land on `next`, urgent work on `hotfixes`, and `master` is a clean release-only history. New repos should adopt v4 directly; existing v3 repos have a [migration guide](docs/migration/v3-to-v4.md).

1. **Adopt the v4 release-flow workflows** — copy the set from [`examples/individual-repo-workflows/release-flow-v4/`](examples/individual-repo-workflows/release-flow-v4/) into your repo's `.github/workflows/`. These are adopted as a set (they depend on each other).
2. **Copy the core CI / publish / tag templates** from [`examples/individual-repo-workflows/core-cicd/`](examples/individual-repo-workflows/core-cicd/) and update `package_name` to your NPM package name. Add the security / automation templates you want from the other subfolders.
3. **Bootstrap the repo** — applies branches + rulesets + security toggles + repo settings in one shot. Two ways:
    - **Org-wide fanout (recommended for ≥3 repos)** — add the target repos to a batch file in [`data/onboarding-batches/`](data/onboarding-batches/) and dispatch `local-org-onboarding.yml` from `CLDMV/.github`'s Actions tab. Runs against N repos in parallel; idempotent.
    - **Per-repo dispatch (one-offs)** — dispatch `v4-bootstrap.yml` from the target repo's Actions tab. Same baseline, scoped to the one repo.
4. **Configure fork-PR approval** — **Settings → Actions → General → Fork pull request workflows from outside collaborators** → "Require approval for all outside collaborators" (or stricter). No public REST API for this knob, so it stays a manual step. The example `ci.yml` runs on `push` for in-repo branches and on `pull_request_target` only for forks; the approval setting prevents fork CI from burning runner minutes until a maintainer clicks **"Approve and run"** on the PR. See [GitHub's docs on approving workflow runs from public forks](https://docs.github.com/en/actions/managing-workflow-runs/approving-workflow-runs-from-public-forks).

For agent-driven scaffolding, point your agent at [`examples/guides/AGENT-SCAFFOLDING.md`](examples/guides/AGENT-SCAFFOLDING.md) — it walks through discovery questions, decisions, copy/customize steps, and validation. For human-driven setup, see [`examples/guides/WORKFLOW-SETUP-GUIDE.md`](examples/guides/WORKFLOW-SETUP-GUIDE.md).

## 🏗️ Architecture Overview

The repo has four layers in `.github/workflows/`:

- **Org entry points** — `workflow-*.yml`. `workflow_call` only; consumer repos reference via `uses: CLDMV/.github/.github/workflows/workflow-X.yml@v4`. Thin layer; maps inputs/secrets and delegates.
- **Reusable building blocks** — `reusable-*.yml`. `workflow_call` only; called by entry points or other reusables. Each bundles a set of jobs gated by `run_*` boolean inputs.
- **Local dogfood** — `local-*.yml`. Runs on THIS repo's events (push, PR, schedule, release). Calls the org's own reusables via **relative** `uses: ./.github/workflows/reusable-X.yml` so PRs test against the PR's version of the reusable, not the published `@v4` tag.
- **Actions** — `.github/actions/`, grouped by technology layer. Almost all are Node (`using: node24`); see [`.github/actions/README.md`](.github/actions/README.md).

The `*-` prefix is convention, not enforced by GitHub Actions. What matters technically is the `on:` block: anything with non-`workflow_call` triggers actually runs on this repo's events.

## 📂 Repository Structure

```
.github/
├── workflows/
│   ├── local-*.yml                              # dogfood — runs on this repo's events
│   │     # core CI / housekeeping:
│   │     local-ci.yml, local-codeql.yml, local-tag-health.yml,
│   │     local-stale.yml, local-labeler.yml, local-welcome.yml,
│   │     local-branch-retention.yml, local-master-commit-audit.yml,
│   │     local-update-major-version-tags.yml, local-publish.yml,
│   │     # v4 staging-branch flow:
│   │     local-next-release.yml, local-next-reset.yml, local-hotfixes-release.yml,
│   │     local-hotfix-redirector.yml, local-pr-title-normalizer.yml,
│   │     local-pending-release-reminder.yml, local-v4-bootstrap.yml, local-feature-pr.yml
│   │
│   ├── workflow-ci.yml                          # CI entry point (called by consumer ci.yml)
│   ├── workflow-publish.yml                     # Publish entry point (called on release merge to master)
│   ├── workflow-docker-publish.yml              # Docker publish entry point
│   ├── workflow-sync-org-labels.yml             # Org label sync entry point
│   ├── workflow-update-major-version-tags.yml   # Floating-tag maintainer entry point
│   ├── workflow-release.yml                     # Legacy v3 release-PR entry point (frozen)
│   │
│   ├── reusable-build-and-test.yml              # Lower-level building blocks
│   ├── reusable-release-management.yml          #   (called by entry points;
│   ├── reusable-publishing.yml                  #    gated by run_* boolean inputs)
│   ├── reusable-tag-health.yml
│   ├── reusable-coverage-badge.yml
│   ├── reusable-coverage-pr-comment.yml
│   ├── reusable-codeql.yml                      # CodeQL SAST
│   ├── reusable-dependency-review.yml           # PR-time CVE diff
│   ├── reusable-container-scan.yml              # Trivy
│   ├── reusable-scorecard.yml                   # OpenSSF Scorecard (SHA-pinned action)
│   ├── reusable-stale.yml                       # Roll-our-own stale sweep
│   ├── reusable-dependabot-auto-merge.yml       # Dependabot auto-merge (rebases into next/hotfixes)
│   ├── reusable-pr-labeler.yml                  # Path-based PR labels
│   ├── reusable-welcome.yml                     # First-time contributor welcome
│   ├── reusable-bundle-size.yml                 # Bundle-size diff on PRs
│   ├── reusable-docs-publish.yml                # gh-pages docs publisher
│   ├── reusable-release-notifier.yml            # Discord / Slack / webhook fan-out (release: published)
│   ├── reusable-pr-notifier.yml                 # Discord / Slack / webhook fan-out (pull_request: opened)
│   ├── reusable-branch-retention.yml            # Prune merged branches
│   ├── reusable-master-commit-audit.yml         # Audit default-branch commit subjects
│   └── reusable-cla.yml                         # CLA bot (central ledger, per-version signing)
└── actions/                                     # reusable actions (Node)
    ├── common/  git/  github/  npm/  node/  docker/  coverage/  workflows/
    └── community/                               # CLA, release notifier
data/github-labels.json                          # org label catalog
docs/conventions/                                # branch-naming, embedded-tests-ci, release-flow-v4
docs/tools/ruleset-generator/                   # browser tool — emits master/next/hotfixes ruleset JSON
scripts/setup-org-rulesets.mjs                  # one-shot installer for the org-wide branch-naming ruleset
examples/
├── guides/                                      # setup, scaffolding, dry-run, and rolling-tag guides
├── repo-seeds/.cla-signatures/                  # initial content for the org CLA-signatures ledger
└── individual-repo-workflows/                   # copy-paste templates for consumers, grouped:
    ├── core-cicd/         (ci, publish, update-major-version-tags; v3-only: release)
    ├── release-flow-v4/   (next-release, hotfixes-release, next-reset, hotfix-redirector,
    │                       pr-title-normalizer, feature-pr, v4-bootstrap)
    ├── release-companions/(tag-health, release-notify, master-commit-audit)
    ├── security/          (codeql, dependency-review, scorecard, cla)
    ├── automation/        (dependabot, dependabot-auto-merge, labeler, welcome, stale, branch-retention)
    └── packaging-docs/    (docker-publish, bundle-size, docs, sync-org-labels)
```

## 🔀 Release flow — v4 (current)

**v4 (`@v4`, current — full design in [docs/conventions/release-flow-v4.md](docs/conventions/release-flow-v4.md)):** a staging-branch model that batches work into single releases and keeps `master` a clean, release-only history.

- Contributors branch off **`next`** (features/fixes); urgent work goes on `hotfix/*` / `security/*` branches whose PRs are auto-redirected to the **`hotfixes`** lane.
- One **persistent `next → master` release PR** (and one `hotfixes → master`) batches all accumulated commits into a single release; a maintainer clicks merge when ready.
- After each release the integration branches auto-reset to `master` HEAD (hotfix releases merge `master` back into `next` to preserve in-flight work). The bot mutates the protected integration branches via the **REST API** — a bot-App `git push` is rejected by the ruleset even with bypass.
- Branch protection is configured per-repo by importing rulesets from the **[ruleset generator](https://cldmv.github.io/.github/tools/ruleset-generator/)** (`master` / `next` / `hotfixes`). The generator pre-adds the bot App to the `next` + `hotfixes` bypass lists (with an opt-out and an App-ID field); `master` is never given bot bypass.
- Bootstrap a repo with **`local-v4-bootstrap.yml`** (creates the integration branches, enables auto-merge, disables auto-delete-head-branches). Cutover steps: [docs/migration/v3-to-v4.md](docs/migration/v3-to-v4.md).

**`@v3` (legacy, frozen):** the previous per-PR flow — every release-eligible PR carried its own `release: vX.Y.Z` version bump with an auto-pushed `chore: bump version` commit. Frozen at v3.8.1, unmaintained but available indefinitely; new repos should adopt `@v4`.

**Tags:** pin **`@v4`** (recommended) for the staging-branch flow — a rolling-major tag tracking the latest release. `@v3` stays pinned to the last v3 release for repos not yet migrated.

## ⚙️ v4 automation (this repo's dogfood)

These `local-*.yml` workflows run the v4 flow **on this repo itself** — the engine behind the release flow above. Consumers don't copy them (they adopt the flow via the ruleset generator + `local-v4-bootstrap.yml`); they're listed here so maintainers can see what fires when.

| Workflow | Trigger | Role |
|---|---|---|
| `local-next-release.yml` | push to `next` | Refreshes the persistent `next → master` release PR (version + changelog) from the `master..next` range. |
| `local-hotfixes-release.yml` | push to `hotfixes` | Same, for the `hotfixes → master` lane (independent patch versioning). |
| `local-hotfix-redirector.yml` | PR opened | Auto-retargets `hotfix/*` / `security/*` PRs **and Dependabot security-advisory PRs** onto the `hotfixes` lane. |
| `local-pr-title-normalizer.yml` | PR opened / synchronize | Normalizes PR titles to the conventional-commit shape the release flow expects. |
| `local-next-reset.yml` | push to `master` (release commit) | After a release, force-resets `next` / `hotfixes` to master HEAD via the **REST API** (gated on the released major tag); merges master into `next` after a hotfix release to preserve in-flight work. |
| `local-publish.yml` | push to `master` (release merge) | Creates the signed `vX.Y.Z` tag + GitHub Release — no npm publish (this repo isn't a package) — which in turn fires the tag roller. |
| `local-update-major-version-tags.yml` | `release: published` / tag push | Rolls the floating `@vN` / `@vN.Y` major/minor tags onto the new release. |
| `local-pending-release-reminder.yml` | daily cron | Files an issue when a release PR has sat unshipped past a threshold. |
| `local-v4-bootstrap.yml` | manual dispatch | One-time: creates `next` + `hotfixes`, enables auto-merge, disables auto-delete-head-branches. |

The other `local-*.yml` (`local-ci`, `local-codeql`, `local-labeler`, `local-welcome`, `local-stale`, `local-branch-retention`, `local-master-commit-audit`, `local-tag-health`) dogfood the reusable building blocks below, calling the matching `reusable-*.yml` (or an inline equivalent) on this repo's own events.

## 🔧 Org entry-point workflows

These `workflow-*.yml` files are what consumer repos invoke via `uses: CLDMV/.github/.github/workflows/<entry>.yml@v4`. Optional `enable_embedded_tests: true` on `workflow-ci.yml` runs a private test suite from a sibling repo via an anonymous gitlink — see [`docs/conventions/embedded-tests-ci.md`](docs/conventions/embedded-tests-ci.md).

### CI Workflow (`workflow-ci.yml`)

- **Purpose**: Test matrix + build for NPM packages. PR-time coverage commentary + on-default-branch coverage-badge publishing.
- **Triggers** (in the consumer repo's `ci.yml`): push to feature/release branches, `pull_request_target` for fork PRs.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-ci.yml@v4`
- **Optional**: `enable_embedded_tests: true` runs a private test suite from a separate private repo linked via an anonymous gitlink (typically at `tests/`). See [`docs/conventions/embedded-tests-ci.md`](docs/conventions/embedded-tests-ci.md).

### Publish Workflow (`workflow-publish.yml`)

- **Purpose**: When a release PR merges into `master`, build + test, publish to NPM and/or GitHub Packages, then create the signed `vX.Y.Z` tag and GitHub Release.
- **Triggers** (in the consumer repo's `publish.yml`): push to default branch with a release-merge commit.
- **Dry-run**: see [`examples/guides/DRY-RUN-GUIDE.md`](examples/guides/DRY-RUN-GUIDE.md). Validates the full pipeline (auth, prerequisites, version metadata) without actually publishing or tagging.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-publish.yml@v4`
- **Satellite packages** (optional): publish extra packages carved from the same build output — slices of the main tarball shipped as their own npm + GitHub Packages packages at the **same version and commit** as the core, each with its own `@scope/name@version` tag and GitHub Release. Opt in with `extra_packages` (a JSON `{ name, dir }` array, or a `dist-packages/*` glob) plus, when the carve isn't folded into `build_command`, `build_subpackages_command`. Full design, tag scheme, and the first-publish/trusted-publisher bootstrap: [`docs/conventions/satellite-packages.md`](docs/conventions/satellite-packages.md); a worked block is in the [`core-cicd/publish.yml`](examples/individual-repo-workflows/core-cicd/publish.yml) example.

### Update Major Version Tags Workflow (`workflow-update-major-version-tags.yml`)

- **Purpose**: Rolls the floating `vX` / `vX.Y` tags onto each new pinned `vX.Y.Z` release so consumers pinning `@v4` automatically track the latest.
- **Triggers** (in the consumer repo): `release:published` and semver-tag push.
- **Usage**: `CLDMV/.github/.github/workflows/workflow-update-major-version-tags.yml@v4`

### Tag Health Workflow (`reusable-tag-health.yml`)

- **Purpose**: Validates and repairs tag health — fixes bot signature drift, re-signs unsigned tags, recreates orphaned tags for GitHub Releases, relocates tags pointing at orphaned commits, maintains rolling major/minor references.
- **Triggers** (in the consumer repo's `tag-health.yml`): weekly cron + manual dispatch.
- **Usage**: `CLDMV/.github/.github/workflows/reusable-tag-health.yml@v4`

### Release Workflow (`workflow-release.yml`) — legacy v3 only

- **Purpose**: The v3 per-PR release model — emits release PRs when commits with `release:` / `release!:` prefixes are pushed. **In v4, this workflow isn't used.** v4 consumers use the staging-branch flow ([above](#-release-flow--v4-current)): `next-release.yml` / `hotfixes-release.yml` open the release PRs from accumulated commits, no `release:` commits required.
- **Triggers** (consumer's `release.yml`): push of `release:` / `release!:` commits to a non-default branch.
- **Usage**: not part of the v4 setup. The workflow is frozen at the final v3 release line for repos that haven't migrated; new repos using v4 should skip this workflow entirely.

## 🧩 Reusable building blocks (consumer-facing)

Reusable `workflow_call` jobs. Each has a copy-paste template in [`examples/individual-repo-workflows/`](examples/individual-repo-workflows/).

| Workflow | Purpose |
|---|---|
| `reusable-codeql.yml` | GitHub static analysis (SAST). Push + PR + weekly schedule. |
| `reusable-dependency-review.yml` | At PR-time, flag new deps with CVEs from GitHub Advisory DB. |
| `reusable-container-scan.yml` | Trivy vulnerability scan; plugs into docker-publish flow. |
| `reusable-scorecard.yml` | OpenSSF Scorecard. SHA-pinned `scorecard-action` lives here (one source of truth — there is no v3.x); consumers call it and can't drift the version. `publish_results` input (default `true`) toggles the public transparency-log publish. |
| `reusable-stale.yml` | Daily auto-stale/auto-close for inactive issues and PRs. Roll-our-own (no `actions/stale` dep). |
| `reusable-dependabot-auto-merge.yml` | Approve + auto-merge patch/minor Dependabot PRs after CI passes. |
| `reusable-pr-labeler.yml` | Path-based PR labels feeding the existing label catalog. |
| `reusable-welcome.yml` | Friendly first-PR / first-issue welcome with conditional links to CONTRIBUTING / CLA / COC. |
| `reusable-bundle-size.yml` | Diff `dist/` sizes on PRs; comment with delta table. For runtime libs. |
| `reusable-docs-publish.yml` | Build docs and push to `gh-pages` branch. |
| `reusable-release-notifier.yml` | On `release:published`, fan out to Discord / Slack / generic webhook. One secret per `<TYPE>_RELEASES_<VIS>_WEBHOOK` — set the secret to enable; unset = no-op. Repo secret overrides org. |
| `reusable-pr-notifier.yml` | On `pull_request:opened`, fan out to Discord / Slack / generic webhook. One secret per `<TYPE>_PR_<VIS>_WEBHOOK`. Same secret precedence as the release notifier. |
| `reusable-branch-retention.yml` | On PR merge: prune most head branches; keep last N of `release/*` / `hotfix/*`. |
| `reusable-master-commit-audit.yml` | On push to default: audit the commit subject against the release-flow pattern set (canonical default lives in the `audit-commit-subject` action); file a deduped Issue on a miss. Centralizes steps + action ref so consumer copies can't drift. |
| `reusable-cla.yml` | Per-CLA-version signing via "I agree" comment, with per-repo override support. Default scope (no consumer `CLA.md`): bot uses org-wide CLA from the private `CLDMV/.cla-signatures` ledger; one signature covers every CLDMV repo until major.minor is bumped. Override scope (consumer has root `CLA.md`): bot enforces that text and bootstraps an immutable snapshot in the ledger on first signature; drift (text changes without a version bump) is rejected. Org members exempt. |

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

- **[examples/](examples/)** — copy-paste workflow templates + onboarding guides.
- **[examples/guides/AGENT-SCAFFOLDING.md](examples/guides/AGENT-SCAFFOLDING.md)** — point an AI agent at this to scaffold the whole workflow set end-to-end into a new consumer repo.
- **[examples/guides/WORKFLOW-SETUP-GUIDE.md](examples/guides/WORKFLOW-SETUP-GUIDE.md)** — per-template setup reference for humans: what each workflow does, required scripts, required secrets, prerequisites.
- **[docs/conventions/release-flow-v4.md](docs/conventions/release-flow-v4.md)** — the full v4 staging-branch release-flow design.
- **[docs/conventions/branch-naming.md](docs/conventions/branch-naming.md)** — branch-prefix conventions enforced by the org ruleset.
- **[docs/conventions/embedded-tests-ci.md](docs/conventions/embedded-tests-ci.md)** — opt-in private-test-repo feature for `ci.yml`.
- **[docs/migration/v3-to-v4.md](docs/migration/v3-to-v4.md)** — cutover guide for repos moving from `@v3` to `@v4`.
- **[.github/actions/README.md](.github/actions/README.md)** — how the actions are structured.
- **[.github/instructions/repo-conventions.instructions.md](.github/instructions/repo-conventions.instructions.md)** — tag, signing, API-version, and secret-naming rules.

## 🤝 Contributing

1. Keep `workflow-*.yml` entry points thin; put job logic in `reusable-*.yml`
   orchestrators and `.github/actions/` actions.
2. Prefer Node (`using: node24`) actions; see the actions README.
3. Test changes with the example workflows before org-wide rollout.
4. Reference internal actions/workflows by version tag (`@v4`), never `@master`.

## 🆘 Support

- Check [examples/](examples/) for usage patterns.
- Review [.github/actions/README.md](.github/actions/README.md) for the action layout.
- Open an issue in this repository.
