# CLDMV branch naming convention

Branch creation is enforced at the git layer via an org-level GitHub Ruleset (see `scripts/setup-org-rulesets.mjs`). Pushing a new branch whose name doesn't match one of the allowed patterns is rejected by the server.

## Allowed patterns

| Pattern | Purpose | What triggers |
|---|---|---|
| `release/X.Y.Z` | Release prep | `workflow-release.yml` (minor/major bump path) |
| `hotfix/X.Y.Z` | Hotfix branches | `workflow-release.yml` (patch path) |
| `feat/<slug>` | New features | normal CI |
| `fix/<slug>` | Bug fixes | normal CI |
| `chore/<slug>` | Maintenance, deps, scripts | normal CI |
| `docs/<slug>` | Documentation only | normal CI (often skipped via `paths-ignore`) |
| `ci/<slug>` | CI/workflow changes | normal CI |
| `refactor/<slug>` | Internal restructuring | normal CI |
| `perf/<slug>` | Performance | normal CI |
| `test/<slug>` | Test-only changes | normal CI |
| `style/<slug>` | Formatting only | normal CI |
| `dependabot/*` | Reserved for Dependabot | normal CI |
| `copilot/*` | Reserved for Copilot autofix | normal CI |
| `master` / `main` | Default branch | publish + tag-health |
| `badges` | Coverage-badge JSON (bot-published) | excluded from CI / release triggers |
| `gh-pages` | Docs site (bot-published) | excluded from CI / release triggers |

## How to install

```bash
GH_TOKEN=<token-with-org-admin> node scripts/setup-org-rulesets.mjs
```

The script is idempotent — re-running updates the existing ruleset (matched by name "CLDMV branch naming convention").

## Bypass

Org admins can bypass the ruleset (configured in the script). Useful for one-off emergency branches that don't fit the convention. Bypass is logged in the audit log.

## Related

- Branch retention: `examples/individual-repo-workflows/automation/branch-retention.yml` keeps the last N of `release/*` and `hotfix/*` and deletes everything else immediately on merge. The retention `exempt_patterns` align with this convention's `master`/`main`/`badges`/`gh-pages` defaults.
- Label catalog: `data/github-labels.json` has prefixed families (`type:`, `status:`, `priority:`, `semver:`, `area:`) that mirror the branch-prefix style.
