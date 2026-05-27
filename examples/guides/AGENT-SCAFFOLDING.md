# 🤖 Agent Scaffolding Guide — CLDMV org workflows (v4)

This file tells an AI agent (Claude Code, etc.) how to scaffold the CLDMV org-level GitHub Actions workflows into a new or existing consumer repo. The scaffold targets **v4** (the staging-branch release flow); `@v3` is legacy/frozen — see the [v3 fallback](#v3-fallback-legacy) at the bottom if you specifically need that. Drop this file into the repo you're scaffolding, point your agent at it, and follow it top-to-bottom.

> **For the user:** open your repo in an agent and say: *"Read `AGENT-SCAFFOLDING.md` and scaffold the CLDMV workflows for this repo."*
>
> **For the agent:** read this file fully before doing anything. Then execute Phases 1 → 5 in order. Ask the user every Discovery question explicitly before acting on it — don't infer.

---

## How to use this file (agent instructions)

You will:

1. **Discover** what kind of repo you're in (Phase 1).
2. **Decide** which templates apply (Phase 2 — a decision table maps Phase 1 answers to template sets).
3. **Scaffold** by copying templates from `https://github.com/CLDMV/.github/tree/v4/examples/individual-repo-workflows/` into the consumer repo's `.github/workflows/` directory, customizing each (Phase 3).
4. **Report manual steps** the user has to do in the GitHub UI (Phase 4 — rulesets, bot bypass, settings, secrets, bootstrap dispatch).
5. **Validate** by running YAML parse + `actionlint`, dispatching `v4-bootstrap.yml`, and running the end-to-end v4 flow test (Phase 5).

Constraints:

- Never invent template content. Always fetch from the `v4` tag of `CLDMV/.github`. Source path under that repo: `examples/individual-repo-workflows/<category>/<file>.yml`. Categories are `core-cicd/`, `release-flow-v4/`, `release-companions/`, `security/`, `automation/`, `packaging-docs/`.
- When you copy a template into the consumer repo, **drop the category subfolder** — files go directly under `.github/workflows/`.
- The `release-flow-v4/` templates are **adopted as a set** — they depend on each other. Don't cherry-pick.
- Never commit secrets, tokens, or API keys.
- Never modify the `master`/`main` branch directly. Always work on a branch like `chore/scaffold-workflows` and open a PR.
- If a step's prerequisites aren't met (e.g. `dependabot-auto-merge.yml` needs "Allow auto-merge" enabled — `v4-bootstrap.yml` enables it), skip the template, note it in your final report, and proceed.

---

## Phase 1 — Discovery

Ask the user these questions before touching any files. Use a single batched question prompt if your tooling allows.

| # | Question | Type | Why it matters |
|---|---|---|---|
| 1 | What's the npm package name (e.g. `@your-org/your-package`)? | string | Required by `ci.yml`, `publish.yml`, `next-release.yml`, `hotfixes-release.yml`, `docker-publish.yml` |
| 2 | Is this an npm-published package, or a meta-package (workflows/actions only, no npm publish)? | enum (`npm` / `meta`) | Determines whether `publish.yml` is needed and what `release_source_only` should be |
| 3 | Does this repo ship a runtime bundle (`dist/`)? | bool | If yes, adopt `bundle-size.yml` |
| 4 | Does this repo publish docs to a `gh-pages` branch? | bool | If yes, adopt `docs.yml` |
| 5 | Is there a `Dockerfile` at the repo root that should publish to GHCR? | bool | If yes, adopt `docker-publish.yml` |
| 6 | Should non-org contributors be required to sign a CLA before their PRs can merge? | bool | If yes, adopt `cla.yml`. The bot uses the org-wide default CLA from the `CLDMV/.cla-signatures` ledger — no per-repo `CLA.md` is needed in the default case. Only add a local `CLA.md` if this repo needs an **override** with custom terms; ask about that separately as Q6b. |
| 6b | (Only if Q6 is yes) Does this repo need a CLA with **different terms** than the org-wide default? | bool | If yes, ask the user for the override CLA text; place at root as `CLA.md` with a `# … CLA — v1.0` header. The bot will detect override scope automatically and bootstrap a snapshot in the ledger on the first signature. |
| 7 | Want Dependabot enabled for this repo? | bool | If yes, adopt `dependabot.yml` (routes PRs to `next`; security updates auto-promote to `hotfixes` via `hotfix-redirector.yml`). The companion `dependabot-auto-merge.yml` is **ON by default** — drop it from the adoption set only if the user explicitly wants to review each Dependabot PR by hand. |
| 8 | Want Discord/Slack/webhook release notifications? | bool | If yes, adopt `release-notify.yml` (and `pr-notify.yml` for PR-opened notifications). Each channel is a single secret named `<TYPE>_<KIND>_<VIS>_WEBHOOK` — set the secret to enable, unset = no-op. No config file required. |
| 9 | What extra branch patterns should be exempt from auto-deletion on PR merge (besides `master`/`main`/`badges`/`gh-pages`/`next`/`hotfixes`)? | list | Feeds `branch-retention.yml`'s `exempt_patterns`. `next` + `hotfixes` are exempt by default — they're the persistent release-PR heads. |
| 10 | Should the standard org-default labels be synced into this repo? | bool | Determines whether to recommend `sync-org-labels.yml` (rare — org-admin only) |
| 11 | Does this repo have (or need) a private test suite pulled from a separate private repo via an anonymous gitlink (typically `tests/`)? | bool | If yes, set `enable_embedded_tests: true` on the `ci.yml` workflow call. Confirm the matching private repo exists per the URL-mapping convention (`<org>/<repo>-tests` for a `tests/` gitlink). See [`docs/conventions/embedded-tests-ci.md`](https://github.com/CLDMV/.github/blob/v4/docs/conventions/embedded-tests-ci.md). Independent of workflow adoption — it's a single input on the existing CI workflow. |

Save all answers before proceeding. If the user says "all defaults", set: name=`@your-org/your-package` (and remind them to fix later), all bools → true except #5 (Docker), #6 (CLA), #6b (CLA override), #10 (org labels), #11 (embedded private tests) which default to false.

---

## Phase 2 — Decision table

Map Phase 1 answers to the template set you'll copy. **Always include** the v4 release flow + core CI/CD + security + automation.

### Always (v4 release flow — adopt as a set)

| Template | From | Note |
|---|---|---|
| `next-release.yml` | `release-flow-v4/next-release.yml` | Customize `package-name` + `build-command` |
| `hotfixes-release.yml` | `release-flow-v4/hotfixes-release.yml` | Customize `package-name` + `build-command` |
| `next-reset.yml` | `release-flow-v4/next-reset.yml` | No customization |
| `hotfix-redirector.yml` | `release-flow-v4/hotfix-redirector.yml` | No customization |
| `pr-title-normalizer.yml` | `release-flow-v4/pr-title-normalizer.yml` | No customization |
| `v4-bootstrap.yml` | `release-flow-v4/v4-bootstrap.yml` | No customization (manual-dispatch, run once after install) |

### Always (core CI/CD)

| Template | From | Note |
|---|---|---|
| `ci.yml` | `core-cicd/ci.yml` | Customize `package_name` |
| `update-major-version-tags.yml` | `core-cicd/update-major-version-tags.yml` | No customization needed |

(`release.yml` is **NOT** scaffolded — it's the v3 per-PR release flow, replaced by `next-release.yml` + `hotfixes-release.yml` above. A repo running both would double-fire on `release:` commits.)

### Always (release companions)

| Template | From | Note |
|---|---|---|
| `master-commit-audit.yml` | `release-companions/master-commit-audit.yml` | No customization needed for default patterns |
| `tag-health.yml` | `release-companions/tag-health.yml` | No customization needed |

### Conditional (based on Phase 1)

| Q | If answer | Add template | From |
|---|---|---|---|
| 2 | `npm` | `publish.yml` | `core-cicd/publish.yml` (customize `package_name`) |
| 2 | `meta` | `publish.yml` (modified) | Same as above but set `publish_to_npm: false`, `publish_to_github_packages: false`, `release_source_only: true`, and stub `test_command`/`build_command` with `echo` lines |
| 3 | true | `bundle-size.yml` | `packaging-docs/bundle-size.yml` |
| 4 | true | `docs.yml` | `packaging-docs/docs.yml` (verify the consumer has `npm run docs:build` or equivalent) |
| 5 | true | `docker-publish.yml` | `packaging-docs/docker-publish.yml` |
| 6 | true | `cla.yml` | `security/cla.yml`. Do **not** add a `CLA.md` to the repo root unless Q6b is also yes — the bot defaults to the org-wide CLA from `CLDMV/.cla-signatures` and a stray local `CLA.md` would silently switch the repo into override scope. Confirm the org-level ledger repo `CLDMV/.cla-signatures` exists — it's a one-time org setup; if missing, tell the user to create it as a private repo and seed from `examples/repo-seeds/.cla-signatures/` in the `.github` repo. |
| 6b | true | `CLA.md` at repo root | Copy the consumer's override text into `CLA.md` with a `# … CLA — v1.0` header. (Or, if they want to start from the default and customize, copy from `https://github.com/CLDMV/.github/blob/v4/examples/repo-seeds/.cla-signatures/cla-versions/v1.0.md` and tell the user to confirm with legal before merging.) The bot detects override scope by file presence; no other config needed. |
| 7 | true | `dependabot.yml` + `dependabot-auto-merge.yml` | Copy `automation/dependabot.yml` to `.github/dependabot.yml` (NOT `.github/workflows/`); copy `automation/dependabot-auto-merge.yml` to `.github/workflows/`. Customize `dependabot.yml` ecosystems for the user's stack (drop the npm block for non-Node repos; add gomod / pip / docker / etc. as needed). |
| 8 | true | `release-notify.yml` + `pr-notify.yml` | `release-companions/release-notify.yml` and `release-companions/pr-notify.yml`. No config file needed. Tell the user to set whichever `<TYPE>_<KIND>_<VIS>_WEBHOOK` secrets they want active (org-level for the default; repo-level overrides). The release-PR notifier is already wired into `next-release.yml` / `hotfixes-release.yml` from Q7's flow — see the `RELEASE_PR` secret block below. |
| 10 | true | `sync-org-labels.yml` | `packaging-docs/sync-org-labels.yml` — **only if this is the org-admin repo** |
| 11 | true | (no new file) | Set `enable_embedded_tests: true` on the existing `ci.yml`'s workflow call. Confirm the matching private repo exists (`<org>/<repo>-tests` for `tests/`; or `<org>/<repo>-embedded` for the consolidated layout — see [`docs/conventions/embedded-tests-ci.md`](https://github.com/CLDMV/.github/blob/v4/docs/conventions/embedded-tests-ci.md)). Confirm the bot App has access to the private repo. |

### Always (security baseline — recommended for any OSS repo)

| Template | From |
|---|---|
| `codeql.yml` | `security/codeql.yml` |
| `dependency-review.yml` | `security/dependency-review.yml` |
| `scorecard.yml` | `security/scorecard.yml` (only on public repos — skip for private) |

### Always (automation)

| Template | From |
|---|---|
| `labeler.yml` | `automation/labeler.yml` |
| `welcome.yml` | `automation/welcome.yml` |
| `stale.yml` | `automation/stale.yml` |
| `branch-retention.yml` | `automation/branch-retention.yml` (set `exempt_patterns` from Phase 1 Q9 — `next`/`hotfixes` are added automatically) |

---

## Phase 3 — Scaffold

Execute in this order:

### 3.1 — Create the target directory

```bash
mkdir -p .github/workflows
```

If `.github/workflows/` already has files, ask the user whether to **merge** (skip existing template names) or **overwrite** before proceeding. Specifically check for an existing `release.yml` (v3 per-PR flow) — flag it for removal so it doesn't conflict with the v4 flow.

### 3.2 — Fetch and write each template

For each template selected in Phase 2:

1. Fetch from `https://raw.githubusercontent.com/CLDMV/.github/v4/examples/individual-repo-workflows/<category>/<file>.yml`
2. Write to `.github/workflows/<file>.yml` (drop the category subfolder)
3. Apply the customizations listed in Phase 2 (search/replace `@your-org/your-package` with the actual `package_name` from Q1; toggle inputs for the `meta`-package case)

Use the tool best suited to your environment — `curl` + `Write` works; `git clone` + `cp` works; a single `gh api` call works.

### 3.3 — Apply per-template customizations

- **`package_name` / `package-name` replacement**: every template containing `@your-org/your-package` needs to be replaced with the actual value from Q1. The placeholder appears 1×–2× per template that uses it.
- **`build-command` for v4 release-flow templates** (`next-release.yml`, `hotfixes-release.yml`): default `"npm run build:ci"`. If the consumer has no build step (meta-package), replace with `"echo '✓ no build step for a meta-package'"`.
- **`meta`-package mode for `publish.yml`** (Q2 = `meta`): set `publish_to_npm: false`, `publish_to_github_packages: false`, `release_source_only: true`, and replace `test_command`/`build_command` defaults with:
  ```yaml
  test_command: "echo '✓ Tests already ran on the PR via ci.yml.'"
  build_command: "echo '✓ No build step for a meta-package.'"
  skip_matrix_tests: true
  skip_performance_tests: true
  min_node_version: ""
  ```
- **`branch-retention.yml`** (from Q9): defaults already exempt `master, main, badges, gh-pages, next, hotfixes`. If the user listed extra patterns, append them: `exempt_patterns: '["master","main","badges","gh-pages","next","hotfixes","<their-branch>"]'`.
- **`cla.yml`** (Q6): no per-repo `CLA.md` by default — the bot uses the org-wide CLA from the ledger. If the user answered Q6b = yes (override), drop their custom CLA text at the repo root as `CLA.md` with a `# … CLA — v1.0` header. (Starting from the default text: fetch `https://raw.githubusercontent.com/CLDMV/.github/v4/examples/repo-seeds/.cla-signatures/cla-versions/v1.0.md` and let the user edit.) Add a TODO in your final report: "if you added a CLA.md, confirm the text with legal before merging". Also add: "confirm the org-level `CLDMV/.cla-signatures` ledger repo exists (private) and the bot App has Contents: write on it; one-time org setup independent of this consumer repo".
- **`release-notify.yml` + `pr-notify.yml`** (Q8): no per-repo config file. Each channel is one secret named `<TYPE>_<KIND>_<VIS>_WEBHOOK`. Tell the user to set whichever secrets they want active (see the "release notifications" section under Phase 4 secrets). Org-level secret = default for all v4 repos; repo-level secret with the same name = override or empty-string mute.

### 3.4 — Create orphan support branches if needed

```bash
# Required if ci.yml's `enable_coverage_badge` stays at the default (true)
git checkout --orphan badges
git rm -rf .
git commit --allow-empty -m "init: badges branch for coverage badge JSON"
git push origin badges
git checkout -  # back to working branch
```

```bash
# Required if docs.yml was adopted
git checkout --orphan gh-pages
git rm -rf .
git commit --allow-empty -m "init: gh-pages branch for docs"
git push origin gh-pages
git checkout -
```

### 3.5 — Optional: customize `labeler.yml` per-repo paths

If the consumer's source layout differs from the org default (`src/`-centric), create `.github/labeler.yml` with custom path → label mappings. See `https://github.com/CLDMV/.github/blob/v4/.github/labeler.default.yml` for the schema.

---

## Phase 4 — Manual steps the user must do

You cannot do these from the CLI. Report them all at the end of your scaffolding run as a single checklist.

### One-time v4 setup (in order, after the scaffold PR is merged to `master`/`main`)

- [ ] **Dispatch `v4-bootstrap.yml`** from the Actions tab — `dry_run: true` first to preview, then `dry_run: false` to apply. Creates `next` + `hotfixes` from master HEAD, enables "Allow auto-merge", and disables "Automatically delete head branches".
- [ ] **Generate + import the three rulesets** (`master` / `next` / `hotfixes`) from the [CLDMV ruleset generator](https://cldmv.github.io/.github/tools/ruleset-generator/). In your repo: **Settings → Rules → Rulesets → New ruleset → Import**.
- [ ] **Add the bot App to the bypass list** on the `next` + `hotfixes` rulesets (the generator pre-adds CLDMV's bot App ID by default; if you opted out, do it by hand here). The bot mutates `next`/`hotfixes` via the REST API on every release — without bypass, GitHub rejects with `GH013`. `master` does **not** get bot bypass.

### Repo settings (Settings tab)

- [ ] **Settings → Actions → General → Fork pull request workflows from outside collaborators** → set to "Require approval for all outside collaborators"
- [ ] Branch protection is handled by the rulesets above; no per-branch rule needed.

### Secrets to add (Settings → Secrets and variables → Actions)

For the bot App attribution (REQUIRED for the v4 flow's release-PR machinery to push as the bot):

- [ ] `CLDMV_BOT_APP_CLIENT_ID`
- [ ] `CLDMV_BOT_APP_PRIVATE_KEY`

For coverage-badge publishing (REQUIRED if `enable_coverage_badge: true`):

- [ ] `CLDMV_BOT_NAME`
- [ ] `CLDMV_BOT_EMAIL`
- [ ] `CLDMV_BOT_GPG_PRIVATE_KEY`
- [ ] `CLDMV_BOT_GPG_PASSPHRASE`

For npm publishing (REQUIRED if Q2 = `npm` and not using trusted publishers):

- [ ] `NPM_TOKEN`

For release / PR / release-PR notifications (OPTIONAL, set whichever channels you want):

The secret name itself encodes the channel — `<TYPE>_<KIND>_<VIS>_WEBHOOK`. Set the secret at the org level for an org-wide default; override or mute per-repo by setting a repo-level secret with the same name (empty string = mute). Visibility is auto-detected (public vs private/internal).

| `<KIND>` | Fires on | Pick whichever of these you want |
|---|---|---|
| `RELEASES` | `release: published` | `DISCORD_RELEASES_PUBLIC_WEBHOOK`, `DISCORD_RELEASES_PRIVATE_WEBHOOK`, `SLACK_RELEASES_PUBLIC_WEBHOOK`, `SLACK_RELEASES_PRIVATE_WEBHOOK`, `GENERIC_RELEASES_PUBLIC_WEBHOOK`, `GENERIC_RELEASES_PRIVATE_WEBHOOK` |
| `PR` | `pull_request: opened` | `DISCORD_PR_PUBLIC_WEBHOOK`, `DISCORD_PR_PRIVATE_WEBHOOK`, `SLACK_PR_PUBLIC_WEBHOOK`, `SLACK_PR_PRIVATE_WEBHOOK`, `GENERIC_PR_PUBLIC_WEBHOOK`, `GENERIC_PR_PRIVATE_WEBHOOK` |
| `RELEASE_PR` | release-PR version-bump (inline, in `next-release.yml` / `hotfixes-release.yml`) | `DISCORD_RELEASE_PR_PUBLIC_WEBHOOK`, `DISCORD_RELEASE_PR_PRIVATE_WEBHOOK`, `SLACK_RELEASE_PR_PUBLIC_WEBHOOK`, `SLACK_RELEASE_PR_PRIVATE_WEBHOOK`, `GENERIC_RELEASE_PR_PUBLIC_WEBHOOK`, `GENERIC_RELEASE_PR_PRIVATE_WEBHOOK` |

### Bot App permissions (Org admin only)

The CLDMV-bot App needs the following permissions added (request from org admin if you don't have access):

- **Organization → Members: Read** — required for `cla.yml` (org-member exemption)
- **Repository → Issues: Write** — `stale.yml`, `master-commit-audit.yml`, `welcome.yml`, `cla.yml`
- **Repository → Pull requests: Write** — `labeler.yml`, `welcome.yml`, `dependabot-auto-merge.yml`, `next-release.yml`, `hotfixes-release.yml`, `pr-title-normalizer.yml`, `hotfix-redirector.yml`, `cla.yml`
- **Repository → Statuses: Write** — `cla.yml` (status check posting)
- **Repository → Contents: Write** — `branch-retention.yml`, `docs.yml`, `next-reset.yml`. Also on `CLDMV/.cla-signatures` specifically for `cla.yml` (signature record writes).
- **Repository → Administration: Write** — `v4-bootstrap.yml` (toggles auto-merge / auto-delete-branches)
- **Repository → Packages: Write** — `docker-publish.yml`

---

## Phase 5 — Validate

### 5.1 — YAML parse

```bash
python3 -c "
import yaml, glob, sys
err = 0
for f in glob.glob('.github/workflows/*.yml'):
    try: yaml.safe_load(open(f))
    except Exception as e: print(f'FAIL {f}: {e}'); err = 1
print('YAML OK' if not err else 'YAML errors')
sys.exit(err)
"
```

### 5.2 — actionlint (optional but recommended)

```bash
curl -sSL https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz | tar -xzC /tmp actionlint
/tmp/actionlint -no-color -ignore 'SC2002' -ignore 'actions/create-github-app-token@v3' .github/workflows/*.yml
```

### 5.3 — Commit + open the scaffold PR

```bash
git add .github/ CLA.md   # CLA.md only if you added it
git commit -m "feat(ci): scaffold CLDMV org workflows (@v4)"
git push -u origin chore/scaffold-workflows
```

Open a PR titled `chore: scaffold CLDMV workflows` against `master`/`main`. Watch the Actions tab for:

- `🧪 CI Tests & Build` — should run + pass
- `🏷️ PR Title Normalizer` — should fire (and may rewrite the title)
- `🏷️ PR Labeler` — should fire and label the PR (if any paths match the labeler config)
- `👋 Welcome Contributor` — should NOT fire (you're an existing contributor, not first-time)

If CI passes, merge to `master`/`main`. The merge triggers `master-commit-audit.yml`. Then proceed to the **v4 one-time setup** in Phase 4.

### 5.4 — End-to-end v4 flow test (after Phase 4 setup completes)

After running `v4-bootstrap.yml`, importing the rulesets, and adding the bot bypass, verify the flow end-to-end:

1. Create a feature branch off `next`: `git checkout next && git pull && git checkout -b feat/test-v4-flow`
2. Make a trivial change (e.g. a comment in a file), commit with a `feat:` message, push.
3. Open a PR from the branch into `next` (NOT `master`).
4. CI runs; merge once green.
5. On merge to `next`, `next-release.yml` fires and creates the persistent `next → master` release PR with version bump + changelog.
6. The release PR remains open until you merge it (v4 batches releases — you click merge when you're ready to ship).

If steps 5–6 work, the v4 flow is wired correctly.

---

## Common pitfalls

1. **`enable_coverage_badge` ON but no `badges` branch** — CI's badge-publish step fails. Solution: create the orphan `badges` branch (Phase 3.4).
2. **`docs.yml` adopted but no `npm run docs:build` script** — docs-publish fails. Solution: add the script to `package.json` or change the `build_command` input in `docs.yml`.
3. **`dependabot-auto-merge.yml` adopted but "Allow auto-merge" is OFF** — solution: run `v4-bootstrap.yml`, or enable manually in Settings → Pull Requests.
3b. **`dependabot.yml` placed in `.github/workflows/` by mistake** — Dependabot won't pick it up there. It must live at `.github/dependabot.yml` (root of `.github/`, not inside `workflows/`).
4. **`cla.yml` adopted but the bot App lacks `Organization → Members: Read`** — the org-member exemption fails open (everyone gets prompted to sign). Solution: request the permission from org admin.
5. **Meta-package `publish.yml` left with `publish_to_npm: true`** — npm publish fails because the package isn't real. Solution: re-check Phase 2 customizations.
6. **`package-name` placeholder left as `@your-org/your-package`** in `next-release.yml` / `hotfixes-release.yml` — release-PR creation fails ("package not found on npm"). Solution: search/replace the placeholder.
7. **Coverage badge secrets missing but `enable_coverage_badge: true`** — coverage-publish step silently downgrades to `github-actions[bot]` and may fail on signed-commit policies. Solution: add the four `CLDMV_BOT_*` GPG secrets OR set `enable_coverage_badge: false`.
8. **`next-release.yml` doesn't fire on first push to `next`** — likely `v4-bootstrap.yml` wasn't dispatched, or the bot App isn't in the `next` ruleset bypass (the chore-bump push to `next` is then rejected with `GH013`).
9. **PR opened into `master` instead of `next`** — that bypasses the v4 batching. Either retarget the PR to `next` or rebase onto `next` and re-open. (Hotfix/security branches and Dependabot security-advisory PRs are auto-redirected to `hotfixes` by `hotfix-redirector.yml`; routine feature/Dependabot-bump PRs are not.)
10. **`v3` per-PR `release.yml` left installed alongside v4** — both flows fire on a `release:` commit and create competing release PRs. Solution: delete `release.yml` (the v4 flow replaces it).

---

## v3 fallback (legacy)

If you specifically need the v3 per-PR release model (one release PR per feature branch, no `next`/`hotfixes` staging), use the **frozen `@v3`** version of this guide and templates instead — point this guide's URLs at `/v3/` rather than `/v4/`, skip the `release-flow-v4/` set, and include `core-cicd/release.yml` from `@v3`. `@v3` is immutable and unmaintained; **new repos are strongly recommended to use v4.**

---

## References (read these only if needed)

- `https://github.com/CLDMV/.github/blob/v4/examples/README.md` — catalog with summaries
- `https://github.com/CLDMV/.github/blob/v4/examples/guides/WORKFLOW-SETUP-GUIDE.md` — per-template setup details + secrets matrix
- `https://github.com/CLDMV/.github/blob/v4/examples/guides/DRY-RUN-GUIDE.md` — how to test release/publish without making changes
- `https://github.com/CLDMV/.github/blob/v4/examples/guides/UPDATE-MAJOR-VERSION-TAGS-GUIDE.md` — how rolling tags work
- `https://github.com/CLDMV/.github/blob/v4/docs/conventions/release-flow-v4.md` — full v4 release-flow design (read this if anything about `next` / `hotfixes` / the persistent PR model is unclear)
- `https://github.com/CLDMV/.github/blob/v4/docs/migration/v3-to-v4.md` — for repos migrating from v3
- `https://github.com/CLDMV/.github/blob/v4/docs/conventions/branch-naming.md` — the branch-name convention `branch-retention.yml` enforces

---

## Final report template

After scaffolding, hand the user this summary (fill in `[brackets]`):

> Scaffolded `[N]` workflows into `.github/workflows/` (v4 staging-branch release flow). Configuration:
> - npm package name: `[name]`
> - package mode: `[npm | meta]`
> - extras adopted: `[docker, bundle-size, docs, cla, etc.]`
>
> ✅ YAML parse passed
> ✅ actionlint passed
> ✅ Scaffold PR opened: `[link]`
>
> **You must still do these manually** (see Phase 4 of `AGENT-SCAFFOLDING.md`):
> - Dispatch `v4-bootstrap.yml` (dry-run, then real)
> - Generate + import the 3 rulesets, add bot App to next/hotfixes bypass
> - `[N]` repo settings changes (listed)
> - `[N]` secrets to add (listed)
> - `[N]` bot App permissions to request from org admin (listed)
> - `[Y/N]` adapt `CLA.md` for legal review
> - `[Y/N]` set `<TYPE>_<KIND>_<VIS>_WEBHOOK` secrets for any notifier channels you want active (org-level default, repo-level override)
>
> Re-run me with "verify v4 scaffolding" after you've completed the v4 setup steps (Phase 4) to run the end-to-end flow test (Phase 5.4).
