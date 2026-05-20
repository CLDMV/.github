# v2 → v3 migration guide

## TL;DR

- Bump every `@v2` reference in your consumer workflows to `@v3`.
- For repos that want the new features, copy fresh templates from `examples/individual-repo-workflows/` (CLA, stale, labeler, welcomer, branch-retention, etc.).
- Configure a few one-time settings (Allow auto-merge, branch protection with required checks, the bot App's org-level `Members: read` permission).
- Verify in the dummy testbed before rolling out to production repos.

v3 is mostly additive — the existing `workflow-ci.yml` / `workflow-release.yml` / `workflow-publish.yml` / `workflow-update-major-version-tags.yml` entry points are backward-compatible with v2 callers. The major bump is because the surface area grew significantly and some Pass-3 bugfixes (P3.1, P3.3) change observable behavior in the release/publish flow.

## What's new in v3

### Pass-3 bugfixes

- **P3.1** — Version-bump base now reads `package.json` from the current default branch HEAD, not the merge-base. Prevents silent version regressions when parallel release PRs merge out of order. Combined with P3.2, closes the bug entirely.
- **P3.2** — New `workflow-sync-open-release-prs.yml` fans out on any PR merge to master and re-updates every open release PR's version + changelog. Requires a new consumer template (`sync-release-prs.yml`).
- **P3.3** — `reusable-publishing.yml` skips publish/release jobs when the package.json version on master matches the latest NPM version. Kills the false-failure noise from non-release PR merges.
- **P3.4** — Shared `tags-${repo}` concurrency group between `workflow-update-major-version-tags.yml` and `reusable-publishing.yml`'s `update-version-tags` job. No consumer change needed.

### New reusable workflows

| Workflow | Template |
|---|---|
| `reusable-codeql.yml` | `examples/.../codeql.yml` |
| `reusable-dependency-review.yml` | `examples/.../dependency-review.yml` |
| `reusable-container-scan.yml` | (called from `reusable-docker-publish.yml`) |
| `reusable-stale.yml` | `examples/.../stale.yml` |
| `reusable-dependabot-auto-merge.yml` | `examples/.../dependabot-auto-merge.yml` |
| `reusable-pr-labeler.yml` | `examples/.../labeler.yml` |
| `reusable-welcome.yml` | `examples/.../welcome.yml` |
| `reusable-bundle-size.yml` | `examples/.../bundle-size.yml` |
| `reusable-docs-publish.yml` | `examples/.../docs.yml` |
| `reusable-release-notifier.yml` | `examples/.../release-notify.yml` |
| `reusable-branch-retention.yml` | `examples/.../branch-retention.yml` |
| `reusable-cla.yml` | `examples/.../cla.yml` |

Plus `workflow-sync-open-release-prs.yml` (consumer template: `examples/.../sync-release-prs.yml`) and `examples/.../master-commit-audit.yml` (uses an action only; no reusable wrapper).

### New consumer-facing actions worth knowing about

- `.github/actions/github/jobs/update-release-pr/` — extracted from the inline YAML of `workflow-release.yml`'s `update-existing-pr` job so it can be reused. Backward-compat for callers of `workflow-release.yml`; only direct callers of the inner job have to switch.
- `.github/actions/github/api/list-release-prs/` — REST helper used by the auto-sync fan-out. Generic; usable in custom workflows that need to enumerate open release PRs.
- `.github/actions/github/steps/sync-pr-labels/` — gained a new `mode: add | replace` input. Default stays `replace` for backward compat.
- `.github/actions/github/api/_api/core.mjs` — new exported `paginate(path, ctx)` helper.

### Org-default config files

- `.github/labeler.default.yml` — path → label-alias mapping consumed by the PR labeler.
- `.github/templates/welcome-issue.md`, `welcome-pr.md` — Mustache-subset templates for the welcomer.
- `.github/templates/release-notifier.default.yml` — channel config for the release notifier.
- `CLA.md` — starting-point Contributor License Agreement text (**legal review required**).
- `docs/conventions/branch-naming.md` — branch-naming convention reference.
- `scripts/setup-org-rulesets.mjs` — installer for the branch-naming Ruleset.

### Label catalog additions

`data/github-labels.json` gains 5 new labels propagated by `sync-org-labels`:

- `type: ci` (aliases: ci, workflows, actions, pipeline)
- `type: config` (aliases: config, configuration, settings)
- `area: core` (aliases: area:core, core, library, runtime)
- `area: cli` (aliases: area:cli, cli, executable, bin)
- `area: tests` (aliases: area:tests, tests, testing, spec)

## Required one-time setup

### Per-repo settings

1. **Settings → Actions → Fork pull request workflows from outside collaborators**:
   - Set to **"Require approval for all outside collaborators"** (or stricter).
   - Prevents fork CI from running until a maintainer clicks **"Approve and run"**.

2. **Settings → Pull Requests → "Allow auto-merge"**:
   - Set to **ON** for any repo adopting `dependabot-auto-merge.yml`. The action validates this and refuses to enable auto-merge otherwise.

3. **Settings → Branches → Branch protection rule on `master`/`main`**:
   - Required for auto-merge to function safely. The action checks `/branches/{ref}/protection` and refuses if no required status checks are configured.

4. **Settings → General → Default branch**: ensure it's `master` or `main` (the divergence and find-divergence actions detect this automatically).

### Org-level bot App permissions

The CLDMV-bot App needs (in addition to existing permissions):

- **Organization permissions → Members: Read** — required for the CLA bot's org-member exemption (`GET /orgs/CLDMV/members/{login}`).
- **Repository permissions → Issues: Write** — for stale, audit, welcome, CLA-check status updates.
- **Repository permissions → Pull requests: Write** — for labeler, welcomer, auto-merge approval.
- **Repository permissions → Contents: Write** — for branch retention, gh-pages publish, CLA-record commit on branches.

### Branch-naming Ruleset (org-wide)

```bash
GH_TOKEN=<token-with-org-admin> node scripts/setup-org-rulesets.mjs
```

Idempotent — re-running updates the existing ruleset.

## Migration steps for an existing v2 consumer repo

1. **Update existing template `uses:` lines from `@v2` to `@v3`** in `ci.yml`, `release.yml`, `publish.yml`, `update-major-version-tags.yml`. Single sed: `sed -i 's|@v2|@v3|g' .github/workflows/*.yml`.

2. **Re-copy the example templates** to pick up the v3 trigger changes (push-only with concurrency, fork-PR handling, etc.). At minimum check that:
   - `ci.yml` uses `branches-ignore: [badges, gh-pages]` on push
   - `release.yml` uses `branches-ignore: [master, main, badges, gh-pages]` on push
   - All have appropriate `concurrency:` blocks

3. **Add `sync-release-prs.yml`** — completes the P3.2 fix that closes the version-regression bug.

4. **Optionally adopt new workflows** by copying their templates:
   - `cla.yml` — gates fork PRs on signing the CLA. Adds friction; valuable for external contributions.
   - `dependabot-auto-merge.yml` — only safe after configuring the repo settings above.
   - `labeler.yml`, `welcome.yml` — quality-of-life for OSS-facing repos.
   - `stale.yml` — for repos with backlog accumulation.
   - `branch-retention.yml` — cleans `feat/*`/`fix/*` after merge; preserves last N of `release/*`/`hotfix/*`.
   - `master-commit-audit.yml` — post-merge audit safety net.
   - `codeql.yml`, `dependency-review.yml`, `scorecard.yml` — security baseline.
   - `tag-health.yml` — wakes the existing reusable on a weekly schedule.
   - `bundle-size.yml`, `docs.yml`, `release-notify.yml` — opt-in per repo.

5. **First-run guidance for stale**: start with `dry_run: true` via `workflow_dispatch` to preview the marking/closing set on existing backlog; flip to live once you're comfortable.

6. **First-run guidance for CLA**: bump the `cla_version` workflow input whenever CLA.md changes meaningfully; previously-signed contributors will be re-prompted.

## Things that look different but aren't breaking

- `reusable-publishing.yml` has new opt-in inputs (`generate_sbom`, `attest_sbom`, `sbom_format`). Defaults are off; existing callers unaffected.
- `workflow-release.yml`'s `update-existing-pr` job collapsed from ~120 lines to ~20 (delegates to new `update-release-pr` action). Same behavior.
- `examples/.../update-major-version-tags.yml` gained an `if:` guard that skips untagged-release events. Reduces wasted runner time; behavior unchanged for tagged releases.

## Things that DO change behavior

- **Publish workflow skips when version unchanged (P3.3).** Where v2 would run-and-fail on `npm publish` for an already-published version, v3 cleanly skips with a `::notice::` annotation. If you have downstream automation that watched for the failure as a signal, switch it to watch the new skip annotation.
- **Release-PR version base reads current master (P3.1).** A patch hotfix branch off v3.5.0 will calculate v3.6.1 if master is currently at v3.6.0, not v3.5.1. This is the correct behavior for a linear-release model; if your repo runs maintenance branches (continuing to ship v3.5.x patches after v3.6.0 lands), you'll need to override `version_bump` and `version` inputs explicitly.

## Roll-back plan

If v3 misbehaves in a consumer repo, switch the `@v3` references back to `@v2` and re-push. The v2 rolling tag still points at the pre-refactor state — no work lost. Open an issue on `CLDMV/.github` with the failure context.
