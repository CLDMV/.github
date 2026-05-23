# Migrating a repo from v3 to v4

Internal institutional memory — how to cut a CLDMV repo over from the v3 per-PR release flow to the v4 staging-branch flow. The full design is in [../conventions/release-flow-v4.md](../conventions/release-flow-v4.md); this is the operational checklist plus the things that bit us during the rollout.

## The model in one paragraph

v3: every release-eligible PR carries its own version bump and its own `release: vX.Y.Z` PR. v4: contributors merge into a long-running **`next`** branch (or **`hotfixes`** for urgent work); one persistent `next → master` PR (and one `hotfixes → master`) batches everything into a single release. `master` stays a clean, release-only history. After each release the integration branches auto-reset to master HEAD.

## Cutover checklist

1. **Install the v4-flow workflows** — copy [`examples/individual-repo-workflows/release-flow-v4/*.yml`](../../examples/individual-repo-workflows/release-flow-v4/) into the repo's `.github/workflows/`. Six files: `next-release.yml`, `hotfixes-release.yml`, `next-reset.yml`, `hotfix-redirector.yml`, `pr-title-normalizer.yml`, and `v4-bootstrap.yml`. Edit the placeholder `package-name` / `build-command` in `next-release.yml` and `hotfixes-release.yml` to match the repo. Commit and push.
2. **Bootstrap** — run `v4-bootstrap.yml` from the Actions tab (`dry_run: true` first, then `false`). Creates `next` + `hotfixes` from master HEAD, enables "Allow auto-merge", and disables "Automatically delete head branches".
3. **Rulesets** — generate `master` / `next` / `hotfixes` rulesets at the [CLDMV ruleset generator](https://github.com/CLDMV/.github/blob/master/docs/tools/ruleset-generator/index.html) (or copy [`data/rulesets/*.json`](https://github.com/CLDMV/.github/tree/master/data/rulesets)) and import via Settings → Rules → Rulesets → Import.
4. **Bot bypass** — add the **bot GitHub App** to the **Bypass list** of the `next` and `hotfixes` rulesets. `master` does NOT get bot bypass. (The generator pre-adds CLDMV's bot by default; if you opted out, do it by hand here.)
5. **Swap existing workflow refs** — if the repo already had v3 workflows installed, point them at `@v4` instead of `@v3`. If the repo runs the v3 per-PR release flow (a `release.yml` calling `workflow-release.yml`), retire it or add `next` + `hotfixes` to its `branches-ignore` so it doesn't double-fire against the integration branches.
6. **Decommission** the v3 fan-out (`workflow-sync-open-release-prs.yml` / `local-sync-release-prs.yml`) — v4 has one persistent PR per lane, so there's nothing to fan out.

## Gotchas (learned the hard way)

- **Bypass must be the bot _App_, not the bot user account or a team containing it.** The v4 workflows authenticate as the App (installation token), so the bypass actor has to be the App. This is the single most common reason a reset/merge to `next`/`hotfixes` is rejected.
- **`hotfix` is an invalid integration-branch name.** Hotfix _work_ branches are `hotfix/*`, and git can't have both a `hotfix` ref (file) and `hotfix/*` refs (directory). The integration branch is named **`hotfixes`** to live outside that namespace.
- **The release that ships an action fix runs the workflow with the _old_ action.** A push to master fires both the post-release sync and `update-major-version-tags` (which rolls the released major tag). Jobs resolve `uses: …@vN` at job start, so without a gate the sync runs the previous release's action code. `local-next-reset.yml` has a **wait-for-tags** job that polls the released major (`@vN`, parsed from the `release:` commit — not a hardcoded `@v3`, which never rolls on a major bump) until it matches the release commit before syncing.
- **A bot App's ruleset bypass is honored on the REST API, NOT on a `git push`.** This is the big one. A push authenticated as the bot App is rejected by `next`/`hotfixes`' require-PR + block-force-push ruleset with GH013 ("Changes must be made through a pull request") *even though the App is in the bypass list with mode Always* — the App's bypass doesn't apply on the raw-git path the way it does on the API. So `force-reset-branch` resets via `PATCH /git/refs/heads/<branch>` (`force: true`) and `merge-master-into-branch` merges via the Merges API. Generalizes: **any unattended bot mutation of a protected branch should go through the REST API, not `git push`.** (A human org-admin's `git push` with bypass *does* work — the gap is App-specific.)
- **The CLI fallback still needs an explicit lease.** `force-reset-branch` keeps a `git push --force-with-lease` fallback. A bare `--force-with-lease` fails with "stale info" against an `x-access-token` URL (no remote-tracking ref), so it reads the target's SHA via `ls-remote` and passes `--force-with-lease=ref:sha`. (The primary API path has no lease concept.)
- **The version bump lives on the integration branch, not master.** Because master only changes via a reviewed squash and the publish flow reads `package.json` as-is, the `chore: bump version` commit must be on `next`/`hotfixes` and ride the squash (§8.1). The bot pushes it directly — hence the bypass requirement.

## Cutting v4.0.0

The `@v4` major line was opened with a **`feat!:` breaking commit** on the release PR (which computes the major bump *and* populates the changelog); `update-major-version-tags` then created `@v4` / `@v4.0` / `@v4.0.0`. Do **not** cut a major with a content-bearing `release: v4.0.0` escape-hatch commit — it double-prefixes the PR title (`release: v4.0.0 - v4.0.0 - …`) and empties the changelog, because release commits are filtered out of the changelog range. `@v3` stays pinned to the last v3.x release (immutable tag), unmaintained but available indefinitely.
