# Release Flow v4 — Design Doc

**Status:** Active (v4.0.0) — the staging-branch flow is the official release model. Implementation history in §11.

**Author:** Nate Corcoran <Shinrai@users.noreply.github.com>

**Date:** 2026-05-21

**Scope:** Refactor the org-level release flow from per-PR version bumps to a staging-branch + persistent-release-PR model. Affects every repo that consumes `CLDMV/.github` workflows. Ships as a major version bump (`@v4`).

---

## 1. Background

Today (v3) every release-eligible PR carries its own version bump. Each feat/fix gets a release PR titled `release: vX.Y.Z` with its own auto-pushed `chore: bump version to X.Y.Z` commit. When multiple PRs are approved in flight, sync-fan-out cascades version recalculation across them.

Real-world friction observed across the v3 cut:

- **Cascade churn.** Three approved patch PRs that should ship as one v3.2.4 ended up as v3.2.4 / v3.2.5 / v3.2.6 — three separate releases for what was conceptually one batch.
- **Race conditions.** `update-major-version-tags` and `sync-fan-out` fire in parallel; if sync resolves `@v3` first, it runs against the previous release's action code (see commit `608f621`).
- **State drift.** The persistent release PR's title/body update path silently bypassed the version-bump path when target was "already bumped on branch" — observable bug 1.
- **Discovery brittleness.** Any change to release-PR title format (e.g., adding `- <subject>` suffix) silently broke the regex sync uses to find them.

The common thread: **per-PR release PRs encode too much state on each contributor's branch**, and that state diverges in messy ways when more than one PR is open.

## 2. Goals

- **Master remains a clean release-only history** — every commit on master is `release: vX.Y.Z - <subject>`.
- **Multiple approved PRs can land in flight without cascading version bumps.** They batch into one release.
- **Hotfix path stays independent** of feature development — security work doesn't queue behind unreleased features.
- **Forgotten releases get noticed** — a pending release sitting unmerged for too long files a tracking issue.
- **Contributor friction stays low** — no changeset files, no special commit message rituals beyond conventional commits.
- **Internal migration is captured** so future-you can reconstruct the design intent. CLDMV is the only consumer; there's no external user base to support — the v3 tag stays available indefinitely (tags are immutable), but no active maintenance promise.

## 3. Non-goals

- Replacing GitHub's UI for merging. Maintainers still click "Squash and merge."
- Mandatory contributor sign-up to changeset tooling.
- Per-commit releases (semantic-release style).
- Auto-merging release PRs to master. Releases are always a manual click.

## 4. Branch model

```
master         release: v3.2.0 ─── release: v3.2.4 ─── release: v3.2.5 ─── release: v3.3.0 ─── ...
                       ▲                  ▲                  ▲                  ▲
                       │ squash from next │ squash from hotfix│ squash from hotfix│ squash from next
                       │                  │                  │                  │
next     ─────────────●──────────────────●──────────────────●──────────────────● (auto-reset to master after each release)
              feat: A ▲ fix: B ▲ feat: C ▲                                feat: D ▲ fix: E ▲
                      │        │         │                                        │        │
                      ▲        ▲         ▲                                        ▲        ▲
                  (contributor PRs squash-merge to next)         (more contributor PRs after hotfix lands)

hotfixes ─────────────────────────────────●──●─────────────────────────────────────────────● (auto-reset to master after each hotfix)
                                          ▲  ▲                                              ▲
                                          │  │                                              │
                                  (hotfix PRs squash-merge to hotfix)              (more hotfixes)
```

| Branch | Purpose | History | Reset behaviour | Auto-merge allowed? |
|---|---|---|---|---|
| `master` | Production. Tagged releases live here. | Release commits only | Never. Protected. | **No** — manual review + green checks |
| `next` | Integration for unreleased features/fixes. | Free-form (squashed contributor commits) | Force-reset to master HEAD after each `next → master` release | **Yes** — contributor PRs with required reviews + green checks |
| `hotfixes` | Integration for urgent fixes to current release. | Free-form (squashed hotfix commits) | Force-reset to master HEAD after each `hotfixes → master` release | **No, by convention** — maintainer doesn't enable auto-merge on hotfix PRs; rulesets enforce required checks + approvals as prerequisites but don't hard-block auto-merge unless Code Owner review is enabled in the generator |
| `feature/*`, `fix/*` | Contributor work. | Whatever they want. | Deleted on merge to `next`. | N/A |
| `hotfix/*`, `security/*` | Hotfix work. | Whatever they want. | Deleted on merge to `hotfixes`. | N/A |

## 5. PR flows

### 5.1 Contributor PR (normal path)

1. Contributor branches off **`next`** (not master).
2. Pushes commits in conventional format (`feat: ...`, `fix(scope): ...`, etc.).
3. **First push of a branch matching a known prefix** (`feat/`, `feature/`, `fix/`, `release/`, `chore/`, `refactor/`, `docs/`, `ci/`, `perf/`, `test/`, `style/`) triggers the **auto-feature-PR workflow** (§6.8) — it opens a PR targeting `next` (or `hotfixes` for `hotfix/*`) with a populated categorized-commits body. The contributor doesn't open the PR manually.
4. **Every subsequent push to the branch** triggers the same workflow's refresh path — the PR body is regenerated from `master..HEAD` (or `<integration>..HEAD`) and edited via `gh pr edit --body-file`. The body always reflects the current commit range.
5. **PR title normalizer** workflow (§6.4) fires on PR open / sync:
   - Reads the PR's commits
   - Determines highest conventional type (breaking > feat > fix > perf > refactor > ...)
   - If PR title doesn't already conform to `<type>(<scope>)?(!): <summary>`, rewrites it
   - Posts a one-line comment explaining the rewrite (idempotent — only comments once)
6. Required-reviews + green-checks pass → **GitHub auto-merges to `next`** (squash).
7. Squash commit on `next` carries the conventional subject from the PR title.
8. Push to `next` triggers the **release-PR refresh workflow** (§ 6.1) — the persistent `next → master` release PR updates its title, body, and labels.

### 5.2 Hotfix PR

1. Contributor branches off **`master`** (not next — hotfixes are patches against current release, not against pending features).
2. Branch named `hotfix/*` or `security/*`.
3. Pushes commits in conventional format.
4. Opens PR. **Target auto-redirector** workflow fires on PR open:
   - Detects `hotfix/*` or `security/*` branch name
   - Calls GitHub API to change PR base from `next` (default) to `hotfixes`
   - Posts a comment: "Redirected to hotfix lane — this will publish as a patch release independent of `next`."
5. **PR title normalizer** runs as in §5.1.
6. Manual maintainer review required (no auto-merge). Squash to `hotfixes`.
7. Push to `hotfixes` triggers the **hotfix-PR refresh workflow** (§6.2).

### 5.3 Release PR (`next → master`)

- **One persistent PR**, opened by the `local-next-release.yml` workflow the first time `next` diverges from master.
- Title format: `release: vX.Y.Z - <subject>` where X.Y.Z is the highest projected version from accumulated commits, and `<subject>` is the oldest matching commit's summary (existing v3 logic).
- Body: full changelog from `master..next`, bot commits filtered, contributors deduped.
- Labels: reflect the projected bump (`semver: major/minor/patch`, plus `release`, plus type/area labels aggregated from contained commits).
- **Updates on every push to `next`** — workflow recalculates version, regenerates body, syncs labels via delta (v3.2.4's label fix carries forward).
- **Maintainer click required to merge.** No auto-merge to master.
- On merge: master gets one `release: vX.Y.Z - <subject>` commit. Tag + publish flow runs. `next` is **force-reset to master HEAD** (§7).

### 5.4 Hotfix release PR (`hotfixes → master`)

- Mirrors §5.3 but for the `hotfixes` branch.
- Independent versioning — patches the current released version, not whatever's pending on `next`.
- Always patch bump (or explicit `release: vX.Y.Z` commit for emergency major/minor — escape hatch).
- On merge: master gets `release: vX.Y.Z - <hotfix subject>`. Tag + publish. **`hotfixes` AND `next` both force-reset** (§7) so they pick up the patched master.

## 6. Workflows

### 6.1 `local-next-release.yml` (new)

Trigger: `push` to `next`.

Job graph:
1. **wait-for-tags** — gate from v3.2.4; ensures the released major tag (`@vN`, parsed from the `release:` commit) matches master HEAD before downstream resolves
2. **detect-changes** — `git log master..next`; if empty, exit (next has been reset, nothing to do)
3. **resolve-or-create-pr** — looks up the persistent `next → master` PR; creates if missing
4. **refresh-pr** — calls a refactored `update-release-pr@v4`:
   - Range = `master..next` (not branch divergence point)
   - Bump = highest across all contained commits
   - Bot commits, release commits, merge commits filtered (v3.2.4 logic)
   - Title-suffix = oldest matching commit (v3.2.4 logic)
   - Label sync = delta-only (v3.2.4 logic)

### 6.2 `local-hotfixes-release.yml` (new)

Mirror of §6.1 but for the `hotfixes` branch.

### 6.3 `local-next-reset.yml` (new)

Trigger: `push` to `master` (only when the head commit is a `release:` commit).

Job graph:
1. **wait-for-tags** — polls the released **major** tag (`@vN`, parsed from the `release: vX.Y.Z` commit — not a hardcoded `@v3`, which never rolls on a major bump) until it matches the release commit. A release also fires `update-major-version-tags` (which rolls `@vN`); since jobs resolve `uses: …@vN` at job start, this gate prevents the sync job from running the *previous* release's action code. (This race is exactly what made the first v3.5.0 reset fail against the old `force-reset-branch`.)
2. **sync-branches** (needs wait-for-tags) — re-syncs the integration branches by lane:
   - **`hotfixes` is always force-reset** to master HEAD after any release.
   - **`next` depends on the released lane** (detected from the PR head ref behind the squash commit's trailing `(#N)`):
     - normal release (`next → master`, or a v3-style `feat → master`): **force-reset `next`** to master HEAD (§7.1).
     - hotfix release (`hotfixes → master`): **merge master into `next`** instead (§7.2 option B), preserving next's accumulated feature work; a no-op (204) when next has nothing extra.
3. The persistent `next → master` / `hotfixes → master` PRs auto-close once their head == base.

**Safety:** force-resets use `force-reset-branch`, which updates the ref via the **REST Git Refs API** (`PATCH …/git/refs/heads/<branch>`, `force: true`) — a bot-App `git push` is rejected by the branch ruleset (GH013) even with bypass, whereas the App's bypass is honored on the API path (same reason §7.2 uses the Merges API). A `git push --force-with-lease` is kept as a fallback. Branches that don't exist are skipped, so it's safe pre-cutover.

### 6.4 `local-pr-title-normalizer.yml` (new)

Trigger: `pull_request` (`opened`, `synchronize`). **Not** `edited` — contributors editing their own title should not trigger a re-normalize loop.

**Skip conditions** (early-exit before any rewrite logic):
- `pull_request.user.type == "Bot"` — any bot-created PR (cldmv-bot, github-actions, dependabot, renovate, etc.) is exempt. This catches every automated PR-creation path without needing markers, since GitHub stamps the property itself.
- PR base ref is `master` AND head ref is `next` or `hotfixes` — the long-running release PRs own their own title format via the release flow.
- PR title starts with `release:` — escape-hatch override (matches v3's emergency-release commit semantics, see §10.2); contributor or maintainer is asserting explicit control of the title, pass through unchanged.

**No markers in PR body.** Markers in the body would leak into the squash-merge commit message when the PR lands. Idempotency is achieved by:

1. **Title rewrite is idempotent by construction.** If the current title already matches `^<type>(\(<scope>\))?(!)?:\s+.+` AND the type is the highest from contained commits (or higher), no rewrite happens. So a re-fire on `synchronize` against an already-conforming title is a no-op.
2. **Comment dedup via comment query.** Before commenting, query `GET /issues/{n}/comments` and check if a comment from the bot starting with a known sentinel phrase (e.g., `"_Auto-normalized PR title:_"`) already exists. If yes, skip.

Job:
1. Skip if `user.type == "Bot"` or base/head ref matches the release-PR pattern.
2. Fetch the PR's commits.
3. Determine highest conventional type from those commits.
4. If PR title already conforms (matches a valid conventional format with the current-or-higher type), exit. (Contributor's manually-written title respected.)
5. Otherwise, rewrite via `PATCH /pulls/{n}` with a new title built from the highest-type commit subject.
6. Query existing comments for the sentinel. If absent, post a one-line explanatory comment. If present, skip — the contributor was already informed.

This means: rewrite happens on first non-conforming evaluation. After that it only re-fires if commits change the highest type AND the title isn't still acceptable. No infinite churn. No marker pollution.

### 6.5 `local-pr-target-redirector.yml` (new)

Trigger: `pull_request opened`.

This single workflow handles both the "default PRs to `next`" and "redirect `hotfix/*` to `hotfixes`" cases, so the repo default branch can stay `master` (no need to change it from the universal convention).

Job:
1. Determine intended base from head branch name:
   - `^(hotfix|security)/` → intended base = `hotfixes`
   - anything else → intended base = `next`
2. If PR's current base ref differs from intended AND wasn't explicitly set by the contributor, call `PATCH /pulls/{n}` to change base.
3. Post an explanatory comment, deduped by querying existing comments for a sentinel phrase (e.g., `"_Auto-redirected PR base:_"`) — same comment-query approach as §6.4 (no body markers, no commit leak).
4. **Respect manual override.** If the contributor explicitly set the target via the GitHub UI (we can't perfectly detect this), they can change it back — the workflow won't re-fire on `edited` events.
5. **Skip bot-created PRs** via `user.type == "Bot"` (consistent with §6.4).

Default-branch decision: **keep `master` as the repo's default branch.** This workflow handles redirection invisibly so contributors don't need to know about `next`. Alternative (change default to `next`) is documented in §10 if preferred.

### 6.6 `local-pending-release-reminder.yml` (new)

Trigger: scheduled (daily, e.g., 09:00 UTC). Schedule cron is a workflow input so consumer repos can adjust.

Inputs (with defaults, configurable per consumer repo):

| Input | Default | Meaning |
|---|---|---|
| `next_threshold_days` | `14` | Days since last release before `next → master` PR triggers a reminder |
| `hotfix_threshold_days` | `3` | Days since last release before `hotfixes → master` PR triggers a reminder |
| `issue_labels` | `"priority: high,type: release"` | Labels applied to the filed reminder issue |
| `dedup_window` | `"week"` | Bucket for dedup: `week` (default) / `day` / `month` |

Job:
1. Find the persistent `next → master` and `hotfixes → master` PRs.
2. For each: compute `last_release_to_master_age_days` from master's last release commit timestamp.
3. If age > threshold AND the PR has commits to ship:
   - File an issue (dedup by `dedup_window` bucket: `release-reminder-{branch}-{ISO-bucket}`)
   - Post a comment on the release PR linking the issue
4. Use existing audit-style dedup so we don't re-file daily.

### 6.8 `local-feature-pr.yml` (new in v4.3.x)

Trigger: `push` to any branch matching the conventional-prefix patterns from [`docs/conventions/branch-naming.md`](branch-naming.md) (`feat/**`, `feature/**`, `fix/**`, `release/**`, `chore/**`, `refactor/**`, `docs/**`, `ci/**`, `perf/**`, `test/**`, `style/**`, `hotfix/**`).

Maps the source branch to its integration target:

- `hotfix/*` → `hotfixes`
- everything else → `next`

Job graph:

1. **determine-target** — case statement on `${GITHUB_REF#refs/heads/}` to pick the target branch; exits silently if the branch doesn't match (so `master`, `badges`, `gh-pages`, `dependabot/*`, etc. are no-ops by default).
2. **create-app-token** — standard org bot App token (read repo, write PRs).
3. **check-existing-pr** — `gh pr list --head <branch> --base <target> --state open`. Records the PR number if one exists.
4. **checkout** with `fetch-depth: 0` and an explicit `git fetch origin <target>` so the next step has `origin/<target>..HEAD` available locally.
5. **get-commit-range** — produces the categorized commit JSON for that range, same machinery `local-next-release.yml` uses.
6. **generate-comprehensive-changelog** — renders the standard Breaking Changes / Features / Bug Fixes / Other Changes / Contributors body. Same format as the persistent release PRs, so feature PRs are visually consistent with release PRs.
7. **create-or-update** — if no existing PR, `gh pr create --body-file`; if one exists, `gh pr edit --body-file`. Title on create is the head commit's first line (preserves conventional-commit prefix for the §6.4 normalizer).

**Loop guard.** Skips when `github.actor` is a bot account (`cldmv-bot[bot]`, `github-actions[bot]`) or the head commit starts with `chore: bump version` — covers the auto-bump pushes from the release-PR machinery.

**Idempotency.** Per-branch concurrency group (`cancel-in-progress: false`) serializes pushes so the existence check doesn't race itself. The refresh path is safe to re-run; `gh pr edit --body-file` is replace-by-content.

**Consumer template:** [`examples/individual-repo-workflows/release-flow-v4/feature-pr.yml`](../../examples/individual-repo-workflows/release-flow-v4/feature-pr.yml). The branch-pattern list and the `case` statement carry `# CUSTOMIZE:` markers — consumer trims to whatever prefixes their repo actually uses.

### 6.9 Branch retention under v4

The existing `local-branch-retention.yml` workflow (called via [`reusable-branch-retention.yml`](../../.github/workflows/reusable-branch-retention.yml)) handles branch cleanup with these rules (full table in [`branch-naming.md`](branch-naming.md#branch-retention-rules)):

- `release/*` keeps last 5
- `hotfix/*` keeps last 3
- `feat/*`, `fix/*`, `chore/*`, `refactor/*`, `docs/*`, `ci/*`, `perf/*`, `test/*`, `style/*` (and any other matched-non-exempt branches) are deleted on PR merge
- `master`, `main`, `badges`, `gh-pages`, `dev`, `next`, `hotfixes` are exempt

The **v4-relevant addition** is that the workflow's `pull_request:` trigger filter must include `next` and `hotfixes` in its `branches:` list. Under v4, contributor PRs merge into those integration branches (not directly into master), so without that addition the workflow never fires on the bulk of merges and feature branches pile up on origin indefinitely. The local dogfood + consumer template both list `[master, main, next, hotfixes]` as of v4.3.x.

The exempt list ensures `next` / `hotfixes` themselves are never deleted — without that line, a release squash (head = `next`, base = `master`) would tell branch-retention to delete `next`, which would break the next release cycle.

### 6.7 Decommissioned

- **`workflow-sync-open-release-prs.yml`** — only one release PR per lane now; no fan-out needed.
- **`local-sync-release-prs.yml`** — same.
- **`local-release.yml`** (the whole v3 per-PR dogfood) — removed in the v4.1.x cleanup. Release PRs are created on the `next`/`hotfixes` integration branches via §6.1/§6.2, not on contributor branches. (The v3 per-PR flow itself remains available to consumers on the frozen `@v3` tag.)

The existing per-PR release-PR flow stays available on `@v3` for repos that need it during migration.

## 7. Branch reset mechanics

### 7.1 `next` reset

After `next → master` merges:
- master moves to e.g. `c1c1c1c release: v3.3.0 - <subject>`
- `next` still has the pre-squash commits (`feat: A`, `fix: B`, `feat: C`)
- Without intervention: the persistent release PR shows "0 changes" but `next`'s branch still has stale commits

Solution: `local-next-reset.yml` force-pushes `next` → `master`. After reset:
- `next` HEAD == master HEAD
- Persistent release PR auto-closes (GitHub closes PRs whose head and base have converged)
- Next push to `next` (next contributor PR merge) re-fires §6.1, whose `resolve-or-create-pr` step finds no open `next → master` PR and creates a fresh one

### 7.2 `hotfixes` reset

Same mechanic, plus: after a hotfix lands on master, **`next` is also reset**. Rationale:
- master has new patch commit (e.g., 3.2.4 → 3.2.5)
- `next` has accumulated features targeting v3.3.0 from base 3.2.4
- After reset of `next` → master (3.2.5), `next`'s feature work is **lost from the branch but preserved in the contributor PRs that landed there** — those PRs are closed (merged to next), and their commits are gone.

This is a problem. **The reset of `next` after a hotfix would lose accumulated feature work.**

Options:
- **A. Re-apply via cherry-pick after reset.** Workflow cherry-picks the squash commits from old-next onto new-next. Risk: conflicts.
- **B. Merge master into next (no force).** Master moves into next as a merge commit; the accumulated features stay. The release PR diff against new master shows only the feature work.
- **C. Block hotfix releases while next has accumulated work.** Force-close-and-restart-from-scratch model.

**Picking B.** Merge master into next via API (allow-merge-commit on next is fine, since next isn't user-facing). Simple, idempotent, no force-push risk. The release PR's diff against master cleanly shows only feature work.

The API merge counts as a push to `next`, which triggers §6.1's existing `on: push: next` pathway — the persistent release PR refreshes automatically, recalculating bump and changelog against the new master base. No separate trigger needed.

### 7.3 Race protection

All resets use `--force-with-lease` (or equivalent API headers when going through the GitHub API). If a contributor PR merges to `next` between the workflow's detection and its push, the lease fails — workflow logs the conflict, retries with re-fetched state.

## 8. Action changes

### 8.1 Modified

| Action | Change | PR 3 outcome |
|---|---|---|
| `check-release-commit` | Planned: add `range-override` for `master..next`. | **Not needed.** Reused as-is — when `update-release-pr` runs on `next`, the merge-base it already computes against `origin/master` *is* the `master..next` base. |
| `update-release-pr` | Planned: add `mode: persistent` input. | **Not needed.** Reused as-is with `head-ref: next`. It already computes `master..next` semantics (merge-base vs `origin/master`, base-version from master HEAD) and pushes the `chore: bump version` commit to `next` — which is **required** (see note below). |
| `find-divergence` | Planned: add `head-branch` / `base-branch` overrides. | **Not needed for PR 3.** Defaults (HEAD vs `origin/master`) are correct when the workflow runs on `next`. May still be added for the hotfix lane (PR 4) if useful. |
| `force-reset-branch` | **Done in PR 3** (the one real action change): added optional `github-token` so the reset can push as the bot via an `x-access-token` URL — required to bypass `next`'s `non_fast_forward` rule. | ✅ shipped on the PR 3 branch |

**Why the `chore: bump version` commit must stay on `next` (correction to an earlier draft).** An earlier version of this doc claimed persistent mode could skip the bump commit and let "master's package.json update via the squash." That is impossible under this design:

- The `master` ruleset (§9) **requires a PR**, **blocks non-fast-forward**, and the **bot is not in master's bypass list** (§9.2). So master's `package.json` can only change through a PR squash-merge — never a direct or amended push.
- A squash-merge can only carry content that already exists on `next`. GitHub can't inject a `package.json` change at squash time.
- The v3 publish flow (`reusable-publishing.yml` → `detect-version` → `extract-version`) reads `package.json` **as-is** from master HEAD and trusts that version. Nothing derives the version from the commit subject.

Therefore the version bump must be present on `next` before the squash, exactly as v3 carries it on per-PR branches. **v4's batching benefit is independent of this** — the win is the single persistent `next → master` PR collapsing many feature commits into one release; where the bump commit lives doesn't change that. `next` is force-reset after every release (§7.1), so accumulated bump commits there are throwaway.

### 8.2 New

| Action | Purpose |
|---|---|
| `force-reset-branch` | Wraps the `--force-with-lease` reset with retry-on-lease-failure. Used by `local-next-reset.yml`. |
| `merge-master-into-branch` | API-driven merge for §7.2's option B. |
| `normalize-pr-title` | Implements §6.4's PR title rewrite. |
| `redirect-hotfix-pr` | Implements §6.5's PR target change. |
| `compute-highest-commit-type` | Standalone helper for the title normalizer (also reusable in `check-release-commit`). |
| `pending-release-reminder` | Implements §6.6 — ages master's last release, finds open `next`/`hotfixes` release PRs, files a deduped tracking issue + comment when stale. |

### 8.3 Unchanged (reused as-is)

- `calculate-version`
- `update-package-version`
- `generate-comprehensive-changelog`
- `update-pr-changelog`
- `sync-pr-labels` (v3.2.4 delta version)
- `compute-label-aliases`, `resolve-labels`
- `create-app-token`, `checkout-code`, `setup-node`

## 9. Branch protection rules

v4 uses **GitHub Rulesets**, not the legacy branch-protection API. Rulesets are imported as JSON via Settings → Rules → Rulesets → New ruleset → "Import a ruleset".

Canonical templates live in [`data/rulesets/`](../../data/rulesets/):

- [`master.json`](../../data/rulesets/master.json) — production branch
- [`next.json`](../../data/rulesets/next.json) — integration branch
- [`hotfixes.json`](../../data/rulesets/hotfixes.json) — hotfix lane

A static generator at [`docs/tools/ruleset-generator/`](https://cldmv.github.io/.github/tools/ruleset-generator/) (hosted via GitHub Pages from this repo) prompts for repo-specific values and emits ready-to-import JSON for each branch. Consumers download the three files and import each in the repo's Settings → Rules → Rulesets UI.

### 9.1 Generator questions

1. **Required approvals** — number (default 1). Optional "team size" pre-fill that auto-sets the number.
2. **Require Code Owner reviews on hotfixes?** — yes/no (default **no**). Requires a `CODEOWNERS` file in the consumer repo to do anything; without one, the rule is a silent no-op. Affects the hotfixes ruleset only.
3. **Require Copilot Code Review (master + hotfixes)?** — yes/no (default **no**). Each PR triggers a Copilot review against the org's Copilot subscription quota; off by default to avoid surprise cost increases. Enable only with a paid Copilot tier.

Everything else is hardcoded into the templates from v4's intended flow:

| Setting | master | next | hotfixes |
|---|---|---|---|
| `non_fast_forward` (block force-push) | yes | yes (bot bypass added manually) | yes (bot bypass added manually) |
| `required_signatures` (GPG) | yes | yes | yes |
| `required_linear_history` | yes | **no** (allows §7.2 API merge commits) | **no** (same merge-commit policy as next) |
| `required_status_checks: ["✅ Required PR Check"]` | yes | yes | yes |
| `code_scanning` (CodeQL `high_or_higher`) | yes | yes | yes |
| `copilot_code_review` (asked) | optional | no | optional |
| `allowed_merge_methods` | `["squash"]` | `["merge"]` | `["merge"]` |
| `required_review_thread_resolution` | yes | yes | yes |
| `dismiss_stale_reviews_on_push` | yes | yes | yes |
| `require_last_push_approval` | no | no | no |
| `deletion` (block branch deletion) | yes | yes | yes |

Consumers whose actual check names differ from `"✅ Required PR Check"` edit the imported ruleset post-import.

### 9.2 bypass_actors (manual, post-import)

Templates ship with `bypass_actors: [{ actor_type: "OrganizationAdmin", bypass_mode: "always" }]` only. After importing each ruleset, consumers manually add their bot to the ruleset's Bypass list via the GitHub UI.

For `next` and `hotfixes`, the bot **must** be in `bypass_actors` — the v4 reset workflows (§6.3, §7.2) push as the bot and would be blocked otherwise. For `master`, the bot does NOT need bypass; master only changes via merged PRs.

CLDMV consumers using `cldmv-bot`: add the App via the ruleset's Bypass list (the UI lets you pick from installed Apps).

### 9.3 Auto-merge

Repo-level "Allow auto-merge" toggle is **ON** (enabled by the bootstrap workflow). Auto-merge is opt-in per PR — each PR's author clicks "Enable auto-merge" to activate it. Effective gating per branch:

- **PRs targeting `next`** (contributor PRs): author enables auto-merge → fires when required approvals + checks pass.
- **PRs targeting `master`** (release PRs from `next`): maintainer leaves auto-merge OFF — releases are always a manual click (see §3 non-goals). Rulesets enforce the prerequisites (required approvals + checks, plus Copilot review if enabled in the generator).
- **PRs targeting `hotfixes`**: maintainer leaves auto-merge OFF — hotfix work is reviewed manually. If the consumer enables Code Owner review (§9.1 question 2) and maintains a `CODEOWNERS` file, that adds a hard gate; otherwise it's convention only.

## 10. Resolved questions + remaining open ones

### 10.1 Resolved

| Question | Decision | Notes |
|---|---|---|
| PR title normalizer scope | Runs on all contributor PRs to `next` AND `hotfixes`. Skips bot-authored PRs. Skips PRs already targeting `master` (release PRs own their own title). | §6.4 |
| Title normalizer re-fire prevention | Fires on `opened` + `synchronize` only. Idempotent via hidden HTML markers. No re-fire if title already conforms. Silent on `synchronize` rewrites (no comment spam). | §6.4 |
| Default branch | **Stays as `master`.** PR target redirection handled invisibly by `local-pr-target-redirector.yml` (§6.5). Alternative (change default to `next`) is supported but not required. | §6.5 |
| Solo-maintainer opt-out for "review from non-author" | **No workflow change needed** — GitHub's branch protection has a "Require approval from someone other than the last pusher" toggle. Solo maintainers leave it off and set required reviewers to 0. Per-repo setting. | §9 |
| Pending-release reminder thresholds | **Configurable via workflow inputs** in `local-pending-release-reminder.yml`. Defaults: 14 days (next), 3 days (hotfix). | §6.6 |
| Co-author trailer in squash commits | **Accept it.** No automatic way to strip co-authors for GitHub-UI-clicked merges. Manual edit of the squash dialog is the only suppression path. Bot co-author is redundant but not wrong. Documented in CONTRIBUTING. | This section |
| Auto-merge enabled? | Repo-level "Allow auto-merge" = ON. Per-branch effective gating via branch protection (§9). PRs to `next` can auto-merge; PRs to `master` / `hotfixes` effectively can't (require manual maintainer review). | §9 |

### 10.2 Resolved in this revision

| Question | Decision |
|---|---|
| Bot-detection mechanism (no markers) | Use `pull_request.user.type == "Bot"` from the event payload. GitHub already stamps every bot account with this property. No PR-body marker needed. |
| Title-rewrite idempotency (no markers) | Check current title against the conventional-commit regex. If it already matches with the correct-or-higher type, exit. Re-fires on `synchronize` become no-ops once the title conforms. |
| Comment dedup (no markers) | Query the PR's comments via `GET /issues/{n}/comments`, scan for a sentinel phrase from a prior bot comment. If present, skip. |
| `release[!]?:` escape hatch | Keep existing v3 semantics: if a `release: vX.Y.Z` commit is present and a version parses out, use that explicit version; if it doesn't parse, fall back to the automatic bump algorithm. Document in CONTRIBUTING for v4. |
| Conflict with sibling during auto-merge | GitHub's auto-merge holds the PR open when there's a merge conflict — it can't fire. Contributor must resolve (rebase or merge) before auto-merge can complete. No special handling needed in our workflows. |

### 10.3 Still open

1. **First-time bootstrap workflow (`local-v4-bootstrap.yml`).** Slimmer scope now that branch protection is handled by the static ruleset generator (§9). Concrete sketch:
   - **Trigger:** `workflow_dispatch` (manual, run once per repo migration)
   - **Inputs:** `next_branch_name` (default `next`), `hotfix_branch_name` (default `hotfixes`), `dry_run` (default `true`)
   - **Steps:**
     1. Create `next` branch from master HEAD (no-op if exists)
     2. Create `hotfixes` branch from master HEAD (no-op if exists)
     3. Enable "Allow auto-merge" at the repo level via `PATCH /repos/{owner}/{repo}` (`allow_auto_merge: true`)
     4. Optionally check in v4 workflow stubs to `.github/workflows/` (skip if already present)
     5. Summary report with a link to the ruleset generator (§9) and the post-import bypass-list step
   - **Branch protection is NOT applied by this workflow.** §9's static generator emits the JSONs; consumer imports them manually via the GitHub UI and adds the bot to the bypass list of `next` and `hotfixes`.
   - **Idempotent:** running twice should be a no-op.
   - **Reversible:** does NOT delete existing v3 workflows. Repo can run v3 and v4 in parallel until ready to fully cut over.

<!-- (resolved: docs/migration/v3-to-v4.md is written all-at-once as part of §11 PR 6 — see §11) -->

## 11. Migration plan

Six PRs in sequence, each independently shippable:

| # | PR | Scope | Releasable on its own? | Status |
|---|---|---|---|---|
| 1 | **Foundation actions** | Add `compute-highest-commit-type`, `normalize-pr-title`, `redirect-hotfix-pr`, `force-reset-branch`, `merge-master-into-branch`. Wire none of them yet. | Yes — additive | ✅ shipped v3.3.0 |
| 2 | **`@v3` parallel: PR title normalizer** | Add `local-pr-title-normalizer.yml` for v3 repos. Backportable feature. | Yes — useful even pre-v4 | ✅ shipped v3.4.0 |
| 3 | **v4 core workflows** | `local-next-release.yml`, `local-next-reset.yml`, refactored `update-release-pr` with `mode: persistent`. Tag as `@v4` rolling. | Yes — new major opt-in | ✅ shipped (v4 preview → v4.0.0 cut) |
| 4 | **v4 hotfix lane** | `local-hotfixes-release.yml`, `local-hotfix-redirector.yml`; extend `local-next-reset.yml` with the wait-for-tags gate + hotfixes reset + §7.2 merge-into-next. | Yes — additive | ✅ shipped (v4 preview → v4.0.0 cut) |
| 5 | **v4 pending-release reminder** | `local-pending-release-reminder.yml` + the `pending-release-reminder` action. | Yes — additive | ✅ shipped (v4 preview → v4.0.0 cut) |
| 6 | **v4 bootstrap + ruleset generator + migration guide** | `local-v4-bootstrap.yml` (slim — branch creation + repo toggle, no branch protection). `data/rulesets/{master,next,hotfixes}.json` templates. `docs/tools/ruleset-generator/` static site. `docs/migration/v3-to-v4.md`. Top-level `README.md` + root dev/test cleanup. **Done at the deliberate cut:** decommissioned `workflow-sync-open-release-prs.yml` + `local-sync-release-prs.yml`; swapped this repo's `@v3`→`@v4` refs (v4.0.2). | Final v4 cut | ✅ shipped — v4.0.0 cut |

Each step ships against `@v4` (rolling major tag). CLDMV repos cut over individually by swapping their workflow files from `@v3` to `@v4` references — older example files remain in git history for reference. `@v3` stays as an immutable tag indefinitely; not actively maintained after v4.0.0.

**`@v4` stability:** PRs 3–5 were an additive preview on `@v4`; the line became **stable when PR 6 landed and v4.0.0 was formally cut**. `@v4` now tracks the latest release (the v4.1.x line) and is the recommended pin.

**How the major was cut (learned the hard way):** v4.0.0 was opened with a **`feat!:` breaking commit**, *not* an explicit `release: v4.0.0` escape-hatch commit. A content-bearing `release:` commit double-prefixes the PR title (`release: v4.0.0 - v4.0.0 - …`) and yields an empty changelog — release commits are filtered out of the changelog range. A breaking `feat!:` is the correct way to open a new major: it computes the major bump *and* populates the changelog from the commit itself.

Migration doc (`docs/migration/v3-to-v4.md`) is written **all at once** as the final step of PR 6 — written for internal institutional memory, not external consumer hand-holding.

## 12. Out of scope (deferred)

- **Conventional Commit linter on contributor commit messages.** Not v4's problem — handled by existing audit.
- **Cross-repo release coordination.** v4 still operates per-repo.
- **Replacing GitHub's auto-merge with a custom workflow.** §4 covers this — global allow-auto-merge + branch protection is sufficient.
- **Strict commit-signature enforcement on contributor commits.** Already covered by GPG enforcement rules per-repo.

## 13. Approval checklist

Before any PR for this work begins:

- [x] Branch names confirmed (`next`, `hotfixes`)
- [x] §7.2 hotfix-while-next-has-work resolution: option B (merge master into next) approved
- [x] §10.1 questions resolved
- [x] Branch protection JSON shape (§9) approved
- [x] Migration sequence (§11) approved
- [x] §10.3 still-open questions resolved
