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

hotfix   ─────────────────────────────────●──●─────────────────────────────────────────────● (auto-reset to master after each hotfix)
                                          ▲  ▲                                              ▲
                                          │  │                                              │
                                  (hotfix PRs squash-merge to hotfix)              (more hotfixes)
```

| Branch | Purpose | History | Reset behaviour | Auto-merge allowed? |
|---|---|---|---|---|
| `master` | Production. Tagged releases live here. | Release commits only | Never. Protected. | **No** — manual review + green checks |
| `next` | Integration for unreleased features/fixes. | Free-form (squashed contributor commits) | Force-reset to master HEAD after each `next → master` release | **Yes** — contributor PRs with required reviews + green checks |
| `hotfix` | Integration for urgent fixes to current release. | Free-form (squashed hotfix commits) | Force-reset to master HEAD after each `hotfix → master` release | **No** — effectively manual via codeowner-required gate (§9); GitHub's repo-level auto-merge toggle is on, but the codeowner approval requirement makes auto-merge unsatisfiable in practice |
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

Trigger: `pull_request` (`opened`, `synchronize`). **Not** `edited` — contributors editing their own title should not trigger a re-normalize loop.

**Skip conditions** (early-exit before any rewrite logic):
- `pull_request.user.type == "Bot"` — any bot-created PR (cldmv-bot, github-actions, dependabot, renovate, etc.) is exempt. This catches every automated PR-creation path without needing markers, since GitHub stamps the property itself.
- PR base ref is `master` AND head ref is `next` or `hotfix` — the long-running release PRs own their own title format via the release flow.
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

This single workflow handles both the "default PRs to `next`" and "redirect `hotfix/*` to `hotfix`" cases, so the repo default branch can stay `master` (no need to change it from the universal convention).

Job:
1. Determine intended base from head branch name:
   - `^(hotfix|security)/` → intended base = `hotfix`
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
| `hotfix_threshold_days` | `3` | Days since last release before `hotfix → master` PR triggers a reminder |
| `issue_labels` | `"priority: high,type: release"` | Labels applied to the filed reminder issue |
| `dedup_window` | `"week"` | Bucket for dedup: `week` (default) / `day` / `month` |

Job:
1. Find the persistent `next → master` and `hotfix → master` PRs.
2. For each: compute `last_release_to_master_age_days` from master's last release commit timestamp.
3. If age > threshold AND the PR has commits to ship:
   - File an issue (dedup by `dedup_window` bucket: `release-reminder-{branch}-{ISO-bucket}`)
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
- Next push to `next` (next contributor PR merge) re-fires §6.1, whose `resolve-or-create-pr` step finds no open `next → master` PR and creates a fresh one

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

The API merge counts as a push to `next`, which triggers §6.1's existing `on: push: next` pathway — the persistent release PR refreshes automatically, recalculating bump and changelog against the new master base. No separate trigger needed.

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

v4 uses **GitHub Rulesets**, not the legacy branch-protection API. Rulesets are imported as JSON via Settings → Rules → Rulesets → New ruleset → "Import a ruleset".

Canonical templates live in [`data/rulesets/`](../../data/rulesets/):

- [`master.json`](../../data/rulesets/master.json) — production branch
- [`next.json`](../../data/rulesets/next.json) — integration branch
- [`hotfix.json`](../../data/rulesets/hotfix.json) — hotfix lane

A static generator at [`docs/tools/ruleset-generator/`](../tools/ruleset-generator/index.html) (hosted via GitHub Pages from this repo) prompts for repo-specific values and emits ready-to-import JSON for each branch. Consumers download the three files and import each in the repo's Settings → Rules → Rulesets UI.

### 9.1 Generator questions

1. **Required approvals** — number (default 1). Optional "team size" pre-fill that auto-sets the number.
2. **Require Code Owner reviews on hotfix?** — yes/no (default yes). Hotfix-only — master and next don't require code-owner review.

Everything else is hardcoded into the templates from v4's intended flow:

| Setting | master | next | hotfix |
|---|---|---|---|
| `non_fast_forward` (block force-push) | yes | **no** (bot resets allowed) | yes |
| `required_signatures` (GPG) | yes | yes | yes |
| `required_linear_history` | yes | **no** (allows §7.2 API merge commits) | yes |
| `required_status_checks: ["✅ Required PR Check"]` | yes | yes | yes |
| `code_scanning` (CodeQL `high_or_higher`) | yes | yes | yes |
| `copilot_code_review` | yes | no | yes |
| `allowed_merge_methods: ["squash"]` | yes | yes | yes |
| `required_review_thread_resolution` | yes | yes | yes |
| `dismiss_stale_reviews_on_push` | yes | yes | yes |
| `deletion` (block branch deletion) | yes | yes | yes |

Consumers whose actual check names differ from `"✅ Required PR Check"` edit the imported ruleset post-import.

### 9.2 bypass_actors (manual, post-import)

Templates ship with `bypass_actors: [{ actor_type: "OrganizationAdmin", bypass_mode: "always" }]` only. After importing each ruleset, consumers manually add their bot to the ruleset's Bypass list via the GitHub UI.

For `next` and `hotfix`, the bot **must** be in `bypass_actors` — the v4 reset workflows (§6.3, §7.2) push as the bot and would be blocked otherwise. For `master`, the bot does NOT need bypass; master only changes via merged PRs.

CLDMV consumers using `cldmv-bot`: add the App via the ruleset's Bypass list (the UI lets you pick from installed Apps).

### 9.3 Auto-merge

Repo-level "Allow auto-merge" toggle is **ON** (enabled by the bootstrap workflow). Per-branch effective gating via rulesets:
- PRs targeting `next`: 1 approval + required checks → auto-merge fires when satisfied.
- PRs targeting `master`: 1 approval + required checks + Copilot review → effectively manual via Copilot-review bottleneck.
- PRs targeting `hotfix`: 1 approval + codeowner gate + required checks → effectively manual via codeowner gate (§4).

## 10. Resolved questions + remaining open ones

### 10.1 Resolved

| Question | Decision | Notes |
|---|---|---|
| PR title normalizer scope | Runs on all contributor PRs to `next` AND `hotfix`. Skips bot-authored PRs. Skips PRs already targeting `master` (release PRs own their own title). | §6.4 |
| Title normalizer re-fire prevention | Fires on `opened` + `synchronize` only. Idempotent via hidden HTML markers. No re-fire if title already conforms. Silent on `synchronize` rewrites (no comment spam). | §6.4 |
| Default branch | **Stays as `master`.** PR target redirection handled invisibly by `local-pr-target-redirector.yml` (§6.5). Alternative (change default to `next`) is supported but not required. | §6.5 |
| Solo-maintainer opt-out for "review from non-author" | **No workflow change needed** — GitHub's branch protection has a "Require approval from someone other than the last pusher" toggle. Solo maintainers leave it off and set required reviewers to 0. Per-repo setting. | §9 |
| Pending-release reminder thresholds | **Configurable via workflow inputs** in `local-pending-release-reminder.yml`. Defaults: 14 days (next), 3 days (hotfix). | §6.6 |
| Co-author trailer in squash commits | **Accept it.** No automatic way to strip co-authors for GitHub-UI-clicked merges. Manual edit of the squash dialog is the only suppression path. Bot co-author is redundant but not wrong. Documented in CONTRIBUTING. | This section |
| Auto-merge enabled? | Repo-level "Allow auto-merge" = ON. Per-branch effective gating via branch protection (§9). PRs to `next` can auto-merge; PRs to `master` / `hotfix` effectively can't (require manual maintainer review). | §9 |

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
   - **Inputs:** `next_branch_name` (default `next`), `hotfix_branch_name` (default `hotfix`), `dry_run` (default `true`)
   - **Steps:**
     1. Create `next` branch from master HEAD (no-op if exists)
     2. Create `hotfix` branch from master HEAD (no-op if exists)
     3. Enable "Allow auto-merge" at the repo level via `PATCH /repos/{owner}/{repo}` (`allow_auto_merge: true`)
     4. Optionally check in v4 workflow stubs to `.github/workflows/` (skip if already present)
     5. Summary report with a link to the ruleset generator (§9) and the post-import bypass-list step
   - **Branch protection is NOT applied by this workflow.** §9's static generator emits the JSONs; consumer imports them manually via the GitHub UI and adds the bot to the bypass list of `next` and `hotfix`.
   - **Idempotent:** running twice should be a no-op.
   - **Reversible:** does NOT delete existing v3 workflows. Repo can run v3 and v4 in parallel until ready to fully cut over.

<!-- (resolved: docs/migration/v3-to-v4.md is written all-at-once as part of §11 PR #6 — see §11) -->

## 11. Migration plan

Six PRs in sequence, each independently shippable:

| # | PR | Scope | Releasable on its own? |
|---|---|---|---|
| 1 | **Foundation actions** | Add `compute-highest-commit-type`, `normalize-pr-title`, `redirect-hotfix-pr`, `force-reset-branch`, `merge-master-into-branch`. Wire none of them yet. | Yes — additive |
| 2 | **`@v3` parallel: PR title normalizer** | Add `local-pr-title-normalizer.yml` for v3 repos. Backportable feature. | Yes — useful even pre-v4 |
| 3 | **v4 core workflows** | `local-next-release.yml`, `local-next-reset.yml`, refactored `update-release-pr` with `mode: persistent`. Tag as `@v4` rolling. | Yes — new major opt-in |
| 4 | **v4 hotfix lane** | `local-hotfix-release.yml`, `local-hotfix-redirector.yml`. | Yes — additive on @v4 |
| 5 | **v4 pending-release reminder** | `local-pending-release-reminder.yml`. | Yes — additive on @v4 |
| 6 | **v4 bootstrap + ruleset generator + migration guide** | `local-v4-bootstrap.yml` (slim — branch creation + repo toggle, no branch protection). `data/rulesets/{master,next,hotfix}.json` templates. `docs/tools/ruleset-generator/` static site (HTML + JS, hosted via Pages from `docs/`). `docs/migration/v3-to-v4.md`. Decommission `workflow-sync-open-release-prs.yml` from @v4. | Final v4 cut |

Each step ships against `@v4` (rolling major tag). CLDMV repos cut over individually by swapping their workflow files from `@v3` to `@v4` references — older example files remain in git history for reference. `@v3` stays as an immutable tag indefinitely; not actively maintained after v4.0.0.

**`@v4` stability between migration PRs:** PRs #3 through #5 are additive but incomplete — `@v4` during that window is an unstable preview. Do not migrate production consumer repos until PR #6 lands and v4.0.0 is formally cut. After PR #6, `@v4` is considered stable.

Migration doc (`docs/migration/v3-to-v4.md`) is written **all at once** as the final step of PR #6 — written for internal institutional memory, not external consumer hand-holding.

## 12. Out of scope (deferred)

- **Conventional Commit linter on contributor commit messages.** Not v4's problem — handled by existing audit.
- **Cross-repo release coordination.** v4 still operates per-repo.
- **Replacing GitHub's auto-merge with a custom workflow.** §4 covers this — global allow-auto-merge + branch protection is sufficient.
- **Strict commit-signature enforcement on contributor commits.** Already covered by GPG enforcement rules per-repo.

## 13. Approval checklist

Before any PR for this work begins:

- [x] Branch names confirmed (`next`, `hotfix`)
- [x] §7.2 hotfix-while-next-has-work resolution: option B (merge master into next) approved
- [x] §10.1 questions resolved
- [ ] Branch protection JSON shape (§9) approved
- [ ] Migration sequence (§11) approved
- [ ] §10.3 still-open questions resolved
