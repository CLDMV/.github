# CLDMV branch naming convention

Branch creation is enforced at the git layer via an org-level GitHub Ruleset (see `scripts/setup-org-rulesets.mjs`). Pushing a new branch whose name doesn't match one of the allowed patterns is rejected by the server.

## Allowed patterns

The **Auto-PR target** column shows where the v4 [`feature-pr.yml`](../../examples/individual-repo-workflows/release-flow-v4/feature-pr.yml) workflow auto-opens (and refreshes) a PR on push. Empty cell = no auto-PR; the maintainer opens one manually if needed.

| Pattern | Purpose | What triggers | Auto-PR target |
|---|---|---|---|
| `release/X.Y.Z` | Release prep | `workflow-release.yml` (minor/major bump path) | `next` |
| `hotfix/X.Y.Z` | Hotfix branches | `workflow-release.yml` (patch path) | `hotfixes` |
| `feat/<slug>` | New features | normal CI | `next` |
| `feature/<slug>` | Same as `feat/<slug>` (alias) | normal CI | `next` |
| `fix/<slug>` | Bug fixes | normal CI | `next` |
| `chore/<slug>` | Maintenance, deps, scripts | normal CI | `next` |
| `docs/<slug>` | Documentation only | CI fires but the inline `paths-gate` job green-lights Required PR Check when every changed file matches `paths_ignore` (docs/md/LICENSE/.gitignore by default) | `next` |
| `ci/<slug>` | CI/workflow changes | normal CI | `next` |
| `refactor/<slug>` | Internal restructuring | normal CI | `next` |
| `perf/<slug>` | Performance | normal CI | `next` |
| `test/<slug>` | Test-only changes | normal CI | `next` |
| `style/<slug>` | Formatting only | normal CI | `next` |
| `dependabot/*` | Reserved for Dependabot | normal CI | — (Dependabot opens its own PRs) |
| `copilot/*` | Reserved for Copilot autofix | normal CI | — (Copilot opens its own PRs) |
| `master` / `main` | Default branch | publish + tag-health | — (the target, not a source) |
| `badges` | Coverage-badge JSON (bot-published) | excluded from CI / release triggers | — |
| `gh-pages` | Docs site (bot-published) | excluded from CI / release triggers | — |

## How to install

```bash
GH_TOKEN=<token-with-org-admin> node scripts/setup-org-rulesets.mjs
```

The script is idempotent — re-running updates the existing ruleset (matched by name "CLDMV branch naming convention").

## Bypass

Org admins can bypass the ruleset (configured in the script). Useful for one-off emergency branches that don't fit the convention. Bypass is logged in the audit log.

## Branch retention rules

Branch retention is enforced by [`examples/individual-repo-workflows/automation/branch-retention.yml`](../../examples/individual-repo-workflows/automation/branch-retention.yml), which calls the org-level [`reusable-branch-retention.yml`](../../.github/workflows/reusable-branch-retention.yml). Defaults (set in the reusable; consumer can override via `retention_rules` + `exempt_patterns` inputs):

| Pattern | Behavior |
|---|---|
| `release/*` | Keep last **5** (oldest beyond the cap deleted on PR merge) |
| `hotfix/*` | Keep last **3** |
| Anything else matched (`feat/*`, `feature/*`, `fix/*`, `chore/*`, `refactor/*`, `docs/*`, `ci/*`, `perf/*`, `test/*`, `style/*`) | Deleted on merge — no retention |
| `master`, `main`, `badges`, `gh-pages`, `dev`, `next`, `hotfixes` | **Exempt — never touched** |

`next` and `hotfixes` are exempt because they're the persistent HEAD branches of the v4 release PRs — without exemption, a release merge would delete its own integration branch.

The workflow fires on **PR-close events whose base is in the `branches:` filter** — `master`, `main`, `next`, or `hotfixes`. Under v4, contributor PRs merge into `next` (features/fixes) or `hotfixes` (urgent patches), not directly into master, so `next`/`hotfixes` must be in the filter or retention never fires for the bulk of merges.

## Related

- Branch retention: see "Branch retention rules" section above.
- Label catalog: `data/github-labels.json` has prefixed families (`type:`, `status:`, `priority:`, `semver:`, `area:`) that mirror the branch-prefix style.
- Auto-PR opener: [`examples/individual-repo-workflows/release-flow-v4/feature-pr.yml`](../../examples/individual-repo-workflows/release-flow-v4/feature-pr.yml) implements the Auto-PR target column above — on push to a matched pattern it opens a PR (or refreshes an existing one) to the listed target with the standard categorized-commits body.
