# Release Flow v4 — Design Doc

**Status:** Draft — pending review. No implementation work yet.

**Author:** Nate Corcoran <Shinrai@users.noreply.github.com>

**Date:** 2026-05-21

**Scope:** Refactor the org-level release flow from per-PR version bumps to a staging-branch + persistent-release-PR model. Affects every repo that consumes `CLDMV/.github` workflows. Ships as a major version bump (`@v4`).

---

## 1. Background

Today (v3) every release-eligible PR carries its own version bump. Each feat/fix gets a release PR titled `release: vX.Y.Z` with its own auto-pushed `chore: bump version to X.Y.Z` commit. When multiple PRs are approved in flight, sync-fan-out cascades version recalculation across them.

Real-world friction observed across the v3 cut:

- **Cascade churn.** Three approved patch PRs that should ship as one v3.2.4 ended up as v3.2.4 / v3.2.5 / v3.2.6 — three separate releases for what was conceptually one batch.
- **Race conditions.** `update-major-version-tags` and `sync-fan-out` fire in parallel; if sync resolves `@v3` first, it runs against the previous release's action code (see commit `608f621`).
- **State drift.** The persistent release PR's title/body update path silently bypassed the version-bump path when target was "already bumped on branch" — observable bug #1.
- **Discovery brittleness.** Any change to release-PR title format (e.g., adding `- <subject>` suffix) silently broke the regex sync uses to find them.

The common thread: **per-PR release PRs encode too much state on each contributor's branch**, and that state diverges in messy ways when more than one PR is open.

## 2. Goals

- **Master remains a clean release-only history** — every commit on master is `release: vX.Y.Z - <subject>`.
- **Multiple approved PRs can land in flight without cascading version bumps.** They batch into one release.
- **Hotfix path stays independent** of feature development — security work doesn't queue behind unreleased features.
- **Forgotten releases get noticed** — a pending release sitting unmerged for too long files a tracking issue.
- **Contributor friction stays low** — no changeset files, no special commit message rituals beyond conventional commits.
- **Downstream consumers** get a clear migration path; existing v3 stays supported until v4 has settled.

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

hotfix   ─────────────────────────────────●──●─────────────────────────────────────────────● (auto-reset to master after each hotfix)
                                          ▲  ▲                                              ▲
                                          │  │                                              │
                                  (hotfix PRs squash-merge to hotfix)              (more hotfixes)
```

| Branch | Purpose | History | Reset behaviour | Auto-merge allowed? |
|---|---|---|---|---|
| `master` | Production. Tagged releases live here. | Release commits only | Never. Protected. | **No** — manual review + green checks |
| `next` | Integration for unreleased features/fixes. | Free-form (squashed contributor commits) | Force-reset to master HEAD after each `next → master` release | **Yes** — contributor PRs with required reviews + green checks |
| `hotfix` | Integration for urgent fixes to current release. | Free-form (squashed hotfix commits) | Force-reset to master HEAD after each `hotfix → master` release | **No** — security-class work; manual review only |
| `feature/*`, `fix/*` | Contributor work. | Whatever they want. | Deleted on merge to `next`. | N/A |
| `hotfix/*`, `security/*` | Hotfix work. | Whatever they want. | Deleted on merge to `hotfix`. | N/A |

## 5. PR flows

### 5.1 Contributor PR (normal path)

1. Contributor branches off **`next`** (not master).
2. Pushes commits in conventional format (`feat: ...`, `fix(scope): ...`, etc.).
3. Opens PR — **target defaults to `next`** (repo's default branch is `next`).
4. **PR title normalizer** workflow fires on PR open / sync:
   - Reads the PR's commits
   - Determines highest conventional type (breaking > feat > fix > perf > refactor > ...)
   - If PR title doesn't already conform to `<type>(<scope>)?(!): <summary>`, rewrites it
   - Posts a one-line comment explaining the rewrite (idempotent — only comments once)
5. Required-reviews + green-checks pass → **GitHub auto-merges to `next`** (squash).
6. Squash commit on `next` carries the conventional subject from the PR title.
7. Push to `next` triggers the **release-PR refresh workflow** (§ 6.1) — the persistent `next → master` release PR updates its title, body, and labels.

### 5.2 Hotfix PR

1. Contributor branches off **`master`** (not next — hotfixes are patches against current release, not against pending features).
2. Branch named `hotfix/*` or `security/*`.
3. Pushes commits in conventional format.
4. Opens PR. **Target auto-redirector** workflow fires on PR open:
   - Detects `hotfix/*` or `security/*` branch name
   - Calls GitHub API to change PR base from `next` (default) to `hotfix`
   - Posts a comment: "Redirected to hotfix lane — this will publish as a patch release independent of `next`."
5. **PR title normalizer** runs as in §5.1.
6. Manual maintainer review required (no auto-merge). Squash to `hotfix`.
7. Push to `hotfix` triggers the **hotfix-PR refresh workflow** (§6.2).

### 5.3 Release PR (`next → master`)

- **One persistent PR**, opened by the `local-next-release.yml` workflow the first time `next` diverges from master.
- Title format: `release: vX.Y.Z - <subject>` where X.Y.Z is the highest projected version from accumulated commits, and `<subject>` is the oldest matching commit's summary (existing v3 logic).
- Body: full changelog from `master..next`, bot commits filtered, contributors deduped.
- Labels: reflect the projected bump (`semver: major/minor/patch`, plus `release`, plus type/area labels aggregated from contained commits).
- **Updates on every push to `next`** — workflow recalculates version, regenerates body, syncs labels via delta (v3.2.4's label fix carries forward).
- **Maintainer click required to merge.** No auto-merge to master.
- On merge: master gets one `release: vX.Y.Z - <subject>` commit. Tag + publish flow runs. `next` is **force-reset to master HEAD** (§7).

### 5.4 Hotfix release PR (`hotfix → master`)

- Mirrors §5.3 but for the `hotfix` branch.
- Independent versioning — patches the current released version, not whatever's pending on `next`.
- Always patch bump (or explicit `release: vX.Y.Z` commit for emergency major/minor — escape hatch).
- On merge: master gets `release: vX.Y.Z - <hotfix subject>`. Tag + publish. **`hotfix` AND `next` both force-reset** (§7) so they pick up the patched master.

## 6. Workflows

### 6.1 `local-next-release.yml` (new)

Trigger: `push` to `next`.

Job graph:
1. **wait-for-tags** — gate from v3.2.4; ensures `@v3` matches master HEAD before downstream resolves
2. **detect-changes** — `git log master..next`; if empty, exit (next has been reset, nothing to do)
3. **resolve-or-create-pr** — looks up the persistent `next → master` PR; creates if missing
4. **refresh-pr** — calls a refactored `update-release-pr@v4`:
   - Range = `master..next` (not branch divergence point)
   - Bump = highest across all contained commits
   - Bot commits, release commits, merge commits filtered (v3.2.4 logic)
   - Title-suffix = oldest matching commit (v3.2.4 logic)
   - Label sync = delta-only (v3.2.4 logic)

### 6.2 `local-hotfix-release.yml` (new)

Mirror of §6.1 but for the `hotfix` branch.

### 6.3 `local-next-reset.yml` (new)

Trigger: `push` to `master` (after release merge).

Job:
1. Detect whether the push is a release commit (`release: vX.Y.Z` subject).
2. Force-push `next` to match master HEAD (`git push origin master:next --force-with-lease`).
3. Force-push `hotfix` to match master HEAD (same).
4. The persistent `next → master` and `hotfix → master` PRs auto-close (no diff).
5. Workflow logs the reset SHAs to the run summary.

**Safety:** uses `--force-with-lease` so a contributor PR landing mid-reset doesn't get blown away — the lease fails, reset is retried after a brief wait.

### 6.4 `local-pr-title-normalizer.yml` (new)

Trigger: `pull_request` (opened, synchronize, edited).

Job:
1. Fetch the PR's commits.
2. Determine highest conventional type from those commits.
3. If PR title doesn't conform, rewrite via `PATCH /pulls/{n}` with a new title.
4. Post a one-line comment (idempotent via hidden HTML marker) explaining the rewrite.

### 6.5 `local-hotfix-redirector.yml` (new)

Trigger: `pull_request opened`.

Job:
1. If PR base ref is not `next`, exit (manual override respected).
2. If PR head branch matches `^(hotfix|security)/`, call `PATCH /pulls/{n}` to change base to `hotfix`.
3. Post a comment explaining the redirect.

### 6.6 `local-pending-release-reminder.yml` (new)

Trigger: scheduled (daily, e.g., 09:00 UTC).

Job:
1. Find the persistent `next → master` and `hotfix → master` PRs.
2. For each: compute `last_release_to_master_age_days` from master's last release commit timestamp.
3. If age > threshold (default 14 days for `next`, 3 days for `hotfix`) AND the PR has commits to ship:
   - File an issue (dedup by week-bucket: `release-reminder-{branch}-{ISO-week}`)
   - Post a comment on the release PR linking the issue
4. Use existing audit-style dedup so we don't re-file daily.

### 6.7 Decommissioned

- **`workflow-sync-open-release-prs.yml`** — only one release PR per lane now; no fan-out needed.
- **`local-sync-release-prs.yml`** — same.
- **`local-release.yml`'s "create release PR" path on contributor branches** — release PRs are not created on contributor branches anymore; they're created on `next`/`hotfix` integration branches via §6.1/§6.2.

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
- Next push to `next` (next contributor PR merge) re-opens / re-creates it

### 7.2 `hotfix` reset

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

### 7.3 Race protection

All resets use `--force-with-lease` (or equivalent API headers when going through the GitHub API). If a contributor PR merges to `next` between the workflow's detection and its push, the lease fails — workflow logs the conflict, retries with re-fetched state.

## 8. Action changes

### 8.1 Modified

| Action | Change |
|---|---|
| `check-release-commit` | Already supports `allow-already-bumped`. Add support for `range-override` so it can be told to use `master..next` directly instead of merge-base. |
| `update-release-pr` | Add `mode: persistent` input. In persistent mode, doesn't push a `chore: bump version` commit to the integration branch (the integration branch's package.json doesn't auto-update; only master's does, via the squash). Title/body/label refresh still runs. |
| `find-divergence` | Add `head-branch` and `base-branch` inputs to override the automatic detection. |

### 8.2 New

| Action | Purpose |
|---|---|
| `force-reset-branch` | Wraps the `--force-with-lease` reset with retry-on-lease-failure. Used by `local-next-reset.yml`. |
| `merge-master-into-branch` | API-driven merge for §7.2's option B. |
| `normalize-pr-title` | Implements §6.4's PR title rewrite. |
| `redirect-hotfix-pr` | Implements §6.5's PR target change. |
| `compute-highest-commit-type` | Standalone helper for the title normalizer (also reusable in `check-release-commit`). |

### 8.3 Unchanged (reused as-is)

- `calculate-version`
- `update-package-version`
- `generate-comprehensive-changelog`
- `update-pr-changelog`
- `sync-pr-labels` (v3.2.4 delta version)
- `compute-label-aliases`, `resolve-labels`
- `create-app-token`, `checkout-code`, `setup-node`

## 9. Branch protection rules

Configured per-repo in `data/branch-protection.json` (new file consumed by the repo-setup workflow).

```json
{
  "master": {
    "required_status_checks": ["Local CI", "Local CodeQL"],
    "required_pull_request_reviews": { "required_approving_review_count": 1 },
    "enforce_admins": false,
    "restrictions": null,
    "required_linear_history": true,
    "allow_force_pushes": false,
    "allow_deletions": false
  },
  "next": {
    "required_status_checks": ["Local CI"],
    "required_pull_request_reviews": { "required_approving_review_count": 1 },
    "allow_force_pushes": { "users": ["cldmv-bot[bot]"] },
    "allow_deletions": false
  },
  "hotfix": {
    "required_status_checks": ["Local CI", "Local CodeQL"],
    "required_pull_request_reviews": { "required_approving_review_count": 1, "require_code_owner_reviews": true },
    "allow_force_pushes": { "users": ["cldmv-bot[bot]"] },
    "allow_deletions": false
  }
}
```

GitHub's "Allow auto-merge" (repo-level toggle) = **ON**. The branch protection rules above determine which PRs can effectively auto-merge:
- PRs targeting `next`: 1 review + Local CI → auto-merge fires
- PRs targeting `master`: 1 review + Local CI + Local CodeQL → fires only when all satisfied (effectively manual since maintainer review is the bottleneck)
- PRs targeting `hotfix`: 1 reviewer + codeowner + all checks → manual

## 10. Open questions

1. **PR title normalizer scope.** Does it run on PRs targeting `hotfix` too? (Probably yes.) On PRs targeting `master`? (No — those are release PRs, format is owned by the release flow.)
2. **Contributors who merge their own PRs.** GitHub branch protection can require "review from someone other than the author". For solo maintainers in their own repos, this needs an opt-out. Configurable per-repo?
3. **Pending-release reminder thresholds.** Default 14 days for `next`, 3 days for `hotfix`. Override via repo-level config?
4. **First-time bootstrap.** When migrating a v3 repo to v4: how do we create `next` and `hotfix` branches and set protection rules with one workflow run? Probably a `local-v4-bootstrap.yml` one-shot workflow that runs on dispatch.
5. **Co-author trailer stripping.** Side quest from v3.2.4 — strip `cldmv-bot[bot]` co-author from squash merge commits. Easiest to do as part of `update-release-pr@v4`'s post-merge logic since v4 owns the merge title/body more directly.
6. **What about `release!:` commits to escape the bump algorithm?** Should still work — `check-release-commit` already honors explicit `release[!]?:` commits. Document that for `next` it overrides the calculated bump.
7. **Documentation lookahead.** Should we update `docs/migration/v3-to-v4.md` proactively as we land each migration PR, or write it once at the end?

## 11. Migration plan

Six PRs in sequence, each independently shippable:

| # | PR | Scope | Releasable on its own? |
|---|---|---|---|
| 1 | **Foundation actions** | Add `compute-highest-commit-type`, `normalize-pr-title`, `redirect-hotfix-pr`, `force-reset-branch`, `merge-master-into-branch`. Wire none of them yet. | Yes — additive |
| 2 | **`@v3` parallel: PR title normalizer** | Add `local-pr-title-normalizer.yml` for v3 repos. Backportable feature. | Yes — useful even pre-v4 |
| 3 | **v4 core workflows** | `local-next-release.yml`, `local-next-reset.yml`, refactored `update-release-pr` with `mode: persistent`. Tag as `@v4` rolling. | Yes — new major opt-in |
| 4 | **v4 hotfix lane** | `local-hotfix-release.yml`, `local-hotfix-redirector.yml`. | Yes — additive on @v4 |
| 5 | **v4 pending-release reminder** | `local-pending-release-reminder.yml`. | Yes — additive on @v4 |
| 6 | **v4 bootstrap + migration guide** | `local-v4-bootstrap.yml` for one-shot migration. `docs/migration/v3-to-v4.md`. Decommission `workflow-sync-open-release-prs.yml` from @v4. | Final v4 cut |

Each step ships against `@v4` (rolling major tag). Existing v3 consumers stay on `@v3` until they choose to migrate. v3 stays supported for a minimum of 6 months after v4.0.0 publishes.

## 12. Out of scope (deferred)

- **Conventional Commit linter on contributor commit messages.** Not v4's problem — handled by existing audit.
- **Cross-repo release coordination.** v4 still operates per-repo.
- **Replacing GitHub's auto-merge with a custom workflow.** §4 covers this — global allow-auto-merge + branch protection is sufficient.
- **Strict commit-signature enforcement on contributor commits.** Already covered by GPG enforcement rules per-repo.

## 13. Approval checklist

Before any PR for this work begins:

- [ ] Branch names confirmed (`next`, `hotfix`)
- [ ] Section 7.2 hotfix-while-next-has-work resolution: **option B (merge master into next)** approved
- [ ] Branch protection JSON shape (§9) approved
- [ ] Migration sequence (§11) approved
- [ ] Open questions (§10) resolved
