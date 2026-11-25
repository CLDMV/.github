# CLDMV branch naming convention

Branch creation is enforced at the git layer by a per-repo GitHub Ruleset named "Branch Naming", built by `buildBranchNaming()` in [`docs/tools/ruleset-generator/builders.mjs`](../tools/ruleset-generator/builders.mjs) (pattern list: `ALLOWED_BRANCH_PATTERNS`). Pushing a new branch whose name doesn't match one of the allowed patterns is rejected by the server. Existing branches aren't affected: the rule only governs creation.

## Allowed patterns

The **Auto-PR target** column shows where the v4 [`feature-pr.yml`](../../examples/individual-repo-workflows/release-flow-v4/feature-pr.yml) workflow auto-opens (and refreshes) a PR on push. Empty cell = no auto-PR; the maintainer opens one manually if needed.

| Pattern           | Purpose                             | What triggers                                                                                                                                                  | Auto-PR target                   |
| ----------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `release/X.Y.Z`   | Release prep                        | `workflow-release.yml` (minor/major bump path)                                                                                                                 | `next`                           |
| `hotfix/X.Y.Z`    | Hotfix branches                     | `workflow-release.yml` (patch path)                                                                                                                            | `hotfixes`                       |
| `feat/<slug>`     | New features                        | normal CI                                                                                                                                                      | `next`                           |
| `feature/<slug>`  | Same as `feat/<slug>` (alias)       | normal CI                                                                                                                                                      | `next`                           |
| `fix/<slug>`      | Bug fixes                           | normal CI                                                                                                                                                      | `next`                           |
| `chore/<slug>`    | Maintenance, scripts                | normal CI                                                                                                                                                      | `next`                           |
| `deps/<slug>`     | Dependency updates / version bumps  | normal CI                                                                                                                                                      | `next`                           |
| `docs/<slug>`     | Documentation only                  | CI fires but the inline `paths-gate` job green-lights Required PR Check when every changed file matches `paths_ignore` (docs/md/LICENSE/.gitignore by default) | `next`                           |
| `ci/<slug>`       | CI/workflow changes                 | normal CI                                                                                                                                                      | `next`                           |
| `refactor/<slug>` | Internal restructuring              | normal CI                                                                                                                                                      | `next`                           |
| `perf/<slug>`     | Performance                         | normal CI                                                                                                                                                      | `next`                           |
| `test/<slug>`     | Test-only changes                   | normal CI                                                                                                                                                      | `next`                           |
| `style/<slug>`    | Formatting only                     | normal CI                                                                                                                                                      | `next`                           |
| `dependabot/*`    | Reserved for Dependabot             | normal CI                                                                                                                                                      | — (Dependabot opens its own PRs) |
| `copilot/*`       | Reserved for Copilot autofix        | normal CI                                                                                                                                                      | — (Copilot opens its own PRs)    |
| `dev`             | Dev-trunk working branch            | normal CI                                                                                                                                                      | — (merged into `next` by hand)   |
| `wip/<who>-<n>`   | In-progress side branch off `dev`   | normal CI                                                                                                                                                      | — (merges into `dev`)            |
| `master` / `main` | Default branch                      | publish + tag-health                                                                                                                                           | — (the target, not a source)     |
| `next`            | Integration branch                  | normal CI, next-release                                                                                                                                        | — (release PR into `master`)     |
| `hotfixes`        | Hotfix lane                         | normal CI, hotfixes-release                                                                                                                                    | — (release PR into `master`)     |
| `badges`          | Coverage-badge JSON (bot-published) | excluded from CI / release triggers                                                                                                                            | —                                |
| `gh-pages`        | Docs site (bot-published)           | excluded from CI / release triggers                                                                                                                            | —                                |

`release/` and `hotfix/` branches must start with a digit (`release/4.45.0`). The other prefixes accept any name below them, nested ones included (`feat/ci/cache`).

## How it's installed

The `rulesets` step of `org-bootstrap-repo` writes it with the other three rulesets (`Protect Master`, `Protect Next`, `Protect Hotfixes`), so `v4-bootstrap.yml` and the org onboarding fanout keep every onboarded repo in sync. Re-running either replaces the ruleset by name. To change the allowed names, edit `ALLOWED_BRANCH_PATTERNS` and this table, release, then re-run onboarding. For a single repo, import `data/rulesets/naming.json` (or the generator's `naming.json`) under Settings → Rules → Rulesets.

GitHub's `creation` rule takes no list of names, so the ruleset targets every branch, excludes the allowed patterns, and blocks creating the rest. Patterns use fnmatch: `*` stops at `/`, `**` crosses it.

## Bypass

Org admins and the bot App bypass the ruleset, so release automation and one-off emergency branches aren't blocked. Bypasses are logged in the audit log.

## Forks

A ruleset only applies to the repo it's on. A contributor's fork belongs to them, so their branch names are up to them, and their PRs arrive as `refs/pull/*`, not as branches in our repo. CLDMV-owned forks are skipped by onboarding by default (`include_forks: false`), so they don't get the ruleset, which keeps upstream branch syncs working.

## Branch retention rules

Branch retention is enforced by [`examples/individual-repo-workflows/automation/branch-retention.yml`](../../examples/individual-repo-workflows/automation/branch-retention.yml), which calls the org-level [`reusable-branch-retention.yml`](../../.github/workflows/reusable-branch-retention.yml). Defaults (set in the reusable; consumer can override via `retention_rules` + `exempt_patterns` inputs):

| Pattern                                                                                                                                    | Behavior                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `release/*`                                                                                                                                | Keep last **5** (oldest beyond the cap deleted on PR merge) |
| `hotfix/*`                                                                                                                                 | Keep last **3**                                             |
| Anything else matched (`feat/*`, `feature/*`, `fix/*`, `chore/*`, `deps/*`, `refactor/*`, `docs/*`, `ci/*`, `perf/*`, `test/*`, `style/*`) | Deleted on merge — no retention                             |
| `master`, `main`, `badges`, `gh-pages`, `dev`, `next`, `hotfixes`                                                                          | **Exempt — never touched**                                  |

`next` and `hotfixes` are exempt because they're the persistent HEAD branches of the v4 release PRs — without exemption, a release merge would delete its own integration branch.

The workflow fires on **PR-close events whose base is in the `branches:` filter** — `master`, `main`, `next`, or `hotfixes`. Under v4, contributor PRs merge into `next` (features/fixes) or `hotfixes` (urgent patches), not directly into master, so `next`/`hotfixes` must be in the filter or retention never fires for the bulk of merges.

## Related

- Branch retention: see "Branch retention rules" section above.
- Label catalog: `data/github-labels.json` has prefixed families (`type:`, `status:`, `priority:`, `semver:`, `area:`) that mirror the branch-prefix style.
- Auto-PR opener: [`examples/individual-repo-workflows/release-flow-v4/feature-pr.yml`](../../examples/individual-repo-workflows/release-flow-v4/feature-pr.yml) implements the Auto-PR target column above — on push to a matched pattern it opens a PR (or refreshes an existing one) to the listed target with the standard categorized-commits body.
