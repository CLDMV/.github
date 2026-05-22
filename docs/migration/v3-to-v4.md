# Migrating a repo from v3 to v4

Internal institutional memory — how to cut a CLDMV repo over from the v3 per-PR release flow to the v4 staging-branch flow. The full design is in [../conventions/release-flow-v4.md](../conventions/release-flow-v4.md); this is the operational checklist plus the things that bit us during the rollout.

## The model in one paragraph

v3: every release-eligible PR carries its own version bump and its own `release: vX.Y.Z` PR. v4: contributors merge into a long-running **`next`** branch (or **`hotfixes`** for urgent work); one persistent `next → master` PR (and one `hotfixes → master`) batches everything into a single release. `master` stays a clean, release-only history. After each release the integration branches auto-reset to master HEAD.

## Cutover checklist

1. **Bootstrap** — run `local-v4-bootstrap.yml` from the Actions tab (`dry_run: true` first, then `false`). Creates `next` + `hotfixes` from master HEAD and enables repo "Allow auto-merge".
2. **Rulesets** — generate `master` / `next` / `hotfixes` rulesets at `docs/tools/ruleset-generator/` (or import `data/rulesets/*.json`) via Settings → Rules → Rulesets → Import.
3. **Bot bypass** — add the **bot GitHub App** to the **Bypass list** of the `next` and `hotfixes` rulesets. `master` does NOT get bot bypass.
4. **Swap workflow refs** — point the repo's workflow files at `@v4` instead of `@v3` once v4.0.0 is cut. Add `next` + `hotfixes` to any `local-release.yml` `branches-ignore` so the v3 per-branch flow doesn't double-fire against them.
5. **Decommission** the v3 fan-out (`workflow-sync-open-release-prs.yml` / `local-sync-release-prs.yml`) — v4 has one persistent PR per lane, so there's nothing to fan out.

## Gotchas (learned the hard way)

- **Bypass must be the bot _App_, not the bot user account or a team containing it.** The v4 workflows authenticate as the App (installation token), so the bypass actor has to be the App. This is the single most common reason a reset/merge to `next`/`hotfixes` is rejected.
- **`hotfix` is an invalid integration-branch name.** Hotfix _work_ branches are `hotfix/*`, and git can't have both a `hotfix` ref (file) and `hotfix/*` refs (directory). The integration branch is named **`hotfixes`** to live outside that namespace.
- **The release that ships an action fix runs the workflow with the _old_ action.** A push to master fires both the post-release sync and `update-major-version-tags` (which rolls `@v3`). Jobs resolve `uses: …@v3` at job start, so without a gate the sync runs the previous release's action code. `local-next-reset.yml` has a **wait-for-tags** job that polls `@v3` until it matches the release commit before syncing.
- **`force-reset-branch` needs an explicit lease.** Pushing as the bot uses an `x-access-token` URL, which has no remote-tracking ref — so a bare `--force-with-lease` fails with "stale info". The action reads the target's current SHA via `ls-remote` and passes `--force-with-lease=ref:sha`.
- **The version bump lives on the integration branch, not master.** Because master only changes via a reviewed squash and the publish flow reads `package.json` as-is, the `chore: bump version` commit must be on `next`/`hotfixes` and ride the squash (§8.1). The bot pushes it directly — hence the bypass requirement.

## Cutting v4.0.0

The `@v4` major line is created by an explicit `release: v4.0.0` commit on the release PR — `check-release-commit`'s escape hatch forces that exact version, and `update-major-version-tags` then creates `@v4` / `@v4.0` / `@v4.0.0`. `@v3` stays pinned to the last v3.x release (immutable tag), unmaintained but available indefinitely.
