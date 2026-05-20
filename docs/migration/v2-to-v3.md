# v2 → v3 migration guide

## TL;DR

- Bump every `@v2` reference in your consumer workflows to `@v3`.
- For repos that want the new features, copy fresh templates from `examples/individual-repo-workflows/`.
- Configure a few one-time settings (Allow auto-merge, branch protection with required checks, the bot App's org-level `Members: read` permission) if you adopt the new automations that need them.

v3 is mostly additive — the existing `workflow-ci.yml` / `workflow-release.yml` / `workflow-publish.yml` / `workflow-update-major-version-tags.yml` entry points are backward-compatible with v2 callers. The major bump is because the surface area grew significantly and a few release/publish bugfixes change observable behavior (see [Things that change behavior](#things-that-change-behavior) below).

## What's new in v3

### Release-flow bugfixes that change observable behavior

- **Release-PR version base now reads from the current default-branch HEAD**, not the merge-base. Fixes silent version regressions when parallel release PRs merged out of order.
- **New `workflow-sync-open-release-prs.yml`** — when any PR merges to master, fans out and re-evaluates every open release PR's version + changelog. Pair it with the version-base fix above to close the regression bug completely.
- **`workflow-publish.yml` skips publish/release when `package.json` version on master matches the latest npm version.** Previously this produced a noisy `npm publish` failure; now it's a clean skip with a `::notice::`.
- **Empty `min_node_version` now means "no matrix"** instead of accidentally creating one (closes [#2](https://github.com/CLDMV/.github/issues/2)).
- **`workflow-publish.yml` triggers on `push: branches: [master, main]` only** (closes [#1](https://github.com/CLDMV/.github/issues/1)). Manual `workflow_dispatch` against other branches still works as an emergency-publish escape hatch.

### New reusable workflows

| Workflow | Consumer template |
|---|---|
| `reusable-codeql.yml` | `examples/.../security/codeql.yml` |
| `reusable-dependency-review.yml` | `examples/.../security/dependency-review.yml` |
| `reusable-container-scan.yml` | (invoked from `reusable-docker-publish.yml`) |
| `reusable-stale.yml` | `examples/.../automation/stale.yml` |
| `reusable-dependabot-auto-merge.yml` | `examples/.../automation/dependabot-auto-merge.yml` |
| `reusable-pr-labeler.yml` | `examples/.../automation/labeler.yml` |
| `reusable-welcome.yml` | `examples/.../automation/welcome.yml` |
| `reusable-bundle-size.yml` | `examples/.../packaging-docs/bundle-size.yml` |
| `reusable-docs-publish.yml` | `examples/.../packaging-docs/docs.yml` |
| `reusable-release-notifier.yml` | `examples/.../release-companions/release-notify.yml` |
| `reusable-branch-retention.yml` | `examples/.../automation/branch-retention.yml` |
| `reusable-cla.yml` | `examples/.../security/cla.yml` |
| `workflow-sync-open-release-prs.yml` | `examples/.../release-companions/sync-release-prs.yml` |
| `examples/.../release-companions/master-commit-audit.yml` | (uses an action directly) |

See [examples/guides/WORKFLOW-SETUP-GUIDE.md](../../examples/guides/WORKFLOW-SETUP-GUIDE.md) for required `package.json` scripts, secrets, and per-workflow prerequisites.

### Label catalog additions

`data/github-labels.json` gains 5 new labels propagated by `sync-org-labels`:

- `type: ci` (aliases: ci, workflows, actions, pipeline)
- `type: config` (aliases: config, configuration, settings)
- `area: core` (aliases: area:core, core, library, runtime)
- `area: cli` (aliases: area:cli, cli, executable, bin)
- `area: tests` (aliases: area:tests, tests, testing, spec)

## Required one-time setup

Only the settings actually needed by the workflows you adopt.

### Per-repo settings

1. **Settings → Actions → "Fork pull request workflows from outside collaborators"** → set to **"Require approval for all outside collaborators"**. Required for safe fork-PR CI on every workflow.
2. **Settings → Pull Requests → "Allow auto-merge"** → ON. Required if you adopt `dependabot-auto-merge.yml`.
3. **Settings → Branches → Branch protection rule** on `master` / `main` with at least one required status check. Required for `dependabot-auto-merge.yml` to function safely.
4. **`badges` branch** (orphan, empty initial commit) — required by `ci.yml` if you keep coverage badging enabled (it's on by default).
5. **`gh-pages` branch** (orphan, empty initial commit) — required by `docs.yml`.

### Org-level bot App permissions

If you adopt the new automations, the CLDMV-bot App needs these permissions in addition to what v2 used:

- **Organization → Members: Read** — for `cla.yml` (lets it exempt org members from CLA signing).
- **Repository → Issues: Write** — for `stale.yml`, `master-commit-audit.yml`, `welcome.yml`, `cla.yml`.
- **Repository → Pull requests: Write** — for `labeler.yml`, `welcome.yml`, `dependabot-auto-merge.yml`.
- **Repository → Contents: Write** — for `branch-retention.yml`, `docs.yml`, the CLA-record commit.

### Org-wide branch-naming Ruleset (optional)

If you want the org-wide branch name convention enforced (`master`, `release/*`, `hotfix/*`, `feat/*`, `fix/*`, …):

```bash
GH_TOKEN=<token-with-org-admin> node scripts/setup-org-rulesets.mjs
```

Idempotent — re-running updates the existing ruleset.

## Migration steps for an existing v2 consumer repo

1. **Bump `@v2` → `@v3`** in your existing templates:

   ```bash
   sed -i 's|@v2|@v3|g' .github/workflows/*.yml
   ```

   This covers `ci.yml`, `release.yml`, `publish.yml`, `update-major-version-tags.yml`, and anything else pointing at this org repo.

2. **Re-copy the example templates** if you want the v3 trigger changes (push-only with concurrency, fork-PR handling). At minimum verify:
   - `ci.yml` uses `branches-ignore: [badges, gh-pages]` on push.
   - `release.yml` uses `branches-ignore: [master, main, badges, gh-pages]` on push.
   - All have appropriate `concurrency:` blocks.

3. **Add `sync-release-prs.yml`** — completes the version-regression fix; cheap addition.

4. **Optionally adopt new workflows** by copying their templates from the appropriate subfolder under `examples/individual-repo-workflows/`:

   | Want… | Template |
   |---|---|
   | Path-based PR labels | `automation/labeler.yml` |
   | First-PR / first-issue welcome | `automation/welcome.yml` |
   | Stale issue / PR sweep | `automation/stale.yml` |
   | Auto-merge Dependabot patch/minor | `automation/dependabot-auto-merge.yml` |
   | Branch retention on merge | `automation/branch-retention.yml` |
   | CLA bot | `security/cla.yml` |
   | CodeQL SAST | `security/codeql.yml` |
   | PR-time CVE diff | `security/dependency-review.yml` |
   | OpenSSF Scorecard | `security/scorecard.yml` |
   | Master-commit audit | `release-companions/master-commit-audit.yml` |
   | Tag-health weekly sweep | `release-companions/tag-health.yml` |
   | Discord / Slack release notify | `release-companions/release-notify.yml` |
   | Bundle-size diff on PRs | `packaging-docs/bundle-size.yml` |
   | gh-pages docs publish | `packaging-docs/docs.yml` |

5. **First-run guidance for `stale.yml`**: dispatch with `dry_run: true` first to preview the marking/closing set; flip to live once you're comfortable.

6. **First-run guidance for `cla.yml`**: bump the `cla_version` workflow input whenever `CLA.md` changes meaningfully; previously-signed contributors will be re-prompted.

## Things that look different but aren't breaking

- `reusable-publishing.yml` has new opt-in inputs (`generate_sbom`, `attest_sbom`, `sbom_format`). Defaults are off; existing callers unaffected.
- `examples/.../update-major-version-tags.yml` gained an `if:` guard that skips untagged-release events. Reduces wasted runner time; tagged releases behave the same.
- Several actions under `.github/actions/` were extracted from inline workflow YAML for reusability. Behavior is identical for callers of `workflow-*.yml`; only direct callers of inner jobs may need to update their `uses:` references.

## Things that change behavior

- **Publish workflow skips when version unchanged.** Where v2 ran-and-failed on `npm publish` for an already-published version, v3 cleanly skips with a `::notice::`. If you had downstream automation watching for the failure as a signal, switch it to watch the new skip annotation.
- **Release-PR version base reads current master.** A patch hotfix branch off `v3.5.0` will calculate `v3.6.1` if master is currently at `v3.6.0`, not `v3.5.1`. This is the correct behavior for a linear-release model. If you run maintenance branches (continuing to ship `v3.5.x` patches after `v3.6.0` lands), override `version_bump` and `version` inputs explicitly.

## Issues resolved in v3

- [#1 — Workflow publish is publishing from PR branches rather than master](https://github.com/CLDMV/.github/issues/1) — **resolved.** New `publish.yml` triggers only on `push: branches: [master, main]`.
- [#2 — `min_node_version` description says matrix is opt-in, but workflow created a matrix anyway](https://github.com/CLDMV/.github/issues/2) — **resolved.** Empty `min_node_version` now correctly means "no matrix"; `workflow-publish.yml` defaults to empty (single check against `max_node_major + lts/*`); `workflow-ci.yml` and `workflow-release.yml` keep `"20"` since CI legitimately wants a matrix.

## Roll-back plan

If v3 misbehaves in a consumer repo, flip the `@v3` references back to `@v2` and re-push. The v2 rolling tag still points at the pre-refactor state — no work lost. Open an issue on `CLDMV/.github` with the failure context.
