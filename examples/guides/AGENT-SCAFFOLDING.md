# 🤖 Agent Scaffolding Guide — CLDMV org workflows

This file tells an AI agent (Claude Code, etc.) how to scaffold the CLDMV org-level GitHub Actions workflows into a new or existing consumer repo. Drop it into the repo you're scaffolding, point your agent at it, and follow it top-to-bottom.

> **For the user:** open your repo in an agent and say: *"Read `AGENT-SCAFFOLDING.md` and scaffold the CLDMV workflows for this repo."*
>
> **For the agent:** read this file fully before doing anything. Then execute Phases 1 → 5 in order. Ask the user every Discovery question explicitly before acting on it — don't infer.

---

## How to use this file (agent instructions)

You will:

1. **Discover** what kind of repo you're in (Phase 1).
2. **Decide** which templates apply (Phase 2 — a decision table maps Phase 1 answers to template sets).
3. **Scaffold** by copying templates from `https://github.com/CLDMV/.github/tree/v3/examples/individual-repo-workflows/` into the consumer repo's `.github/workflows/` directory, customizing each (Phase 3).
4. **Report manual steps** the user has to do in the GitHub UI (Phase 4 — settings + secrets you can't change from the CLI).
5. **Validate** by running YAML parse + `actionlint` and opening a tiny test PR (Phase 5).

Constraints:

- Never invent template content. Always fetch from the v3 tag of `CLDMV/.github`. Source path under that repo: `examples/individual-repo-workflows/<category>/<file>.yml`. Categories are `core-cicd/`, `release-companions/`, `security/`, `automation/`, `packaging-docs/`.
- When you copy a template into the consumer repo, **drop the category subfolder** — files go directly under `.github/workflows/`.
- Never commit secrets, tokens, or API keys.
- Never modify the `master`/`main` branch directly. Always work on a branch like `chore/scaffold-workflows` and open a PR.
- If a step's prerequisites aren't met (e.g. `dependabot-auto-merge.yml` needs "Allow auto-merge" enabled), skip the template, note it in your final report, and proceed.

---

## Phase 1 — Discovery

Ask the user these questions before touching any files. Use a single batched question prompt if your tooling allows.

| # | Question | Type | Why it matters |
|---|---|---|---|
| 1 | What's the npm package name (e.g. `@your-org/your-package`)? | string | Required by `ci.yml`, `release.yml`, `publish.yml`, `docker-publish.yml` |
| 2 | Is this an npm-published package, or a meta-package (workflows/actions only, no npm publish)? | enum (`npm` / `meta`) | Determines whether `publish.yml` is needed and what `release_source_only` should be |
| 3 | Does this repo ship a runtime bundle (`dist/`)? | bool | If yes, adopt `bundle-size.yml` |
| 4 | Does this repo publish docs to a `gh-pages` branch? | bool | If yes, adopt `docs.yml` |
| 5 | Is there a `Dockerfile` at the repo root that should publish to GHCR? | bool | If yes, adopt `docker-publish.yml` |
| 6 | Should non-org contributors be required to sign a CLA before their PRs can merge? | bool | If yes, adopt `cla.yml` (also requires `CLA.md` in repo) |
| 7 | Want Dependabot's patch/minor PRs auto-merged after CI passes? | bool | If yes, adopt `dependabot-auto-merge.yml` (also requires repo "Allow auto-merge" setting) |
| 8 | Want Discord/Slack release notifications? | bool | If yes, adopt `release-notify.yml` (also requires `.github/release-notifier.yml` + per-channel webhook secrets) |
| 9 | What branches should stay protected from auto-deletion on PR merge (besides `master`/`main`/`badges`/`gh-pages`)? | list | Feeds `branch-retention.yml`'s `exempt_patterns` input |
| 10 | Should the standard org-default labels be synced into this repo? | bool | Determines whether to recommend `sync-org-labels.yml` (rare — org-admin only) |

Save all answers before proceeding. If the user says "all defaults", set: name=`@your-org/your-package` (and remind them to fix later), all bools → true except #5 (Docker), #6 (CLA), #10 (org labels) which default to false.

---

## Phase 2 — Decision table

Map Phase 1 answers to the template set you'll copy. **Always include** the four core templates regardless of answers.

### Always (core CI/CD)

| Template | From | Note |
|---|---|---|
| `ci.yml` | `core-cicd/ci.yml` | Customize `package_name` |
| `release.yml` | `core-cicd/release.yml` | Customize `package_name` |
| `update-major-version-tags.yml` | `core-cicd/update-major-version-tags.yml` | No customization needed |

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
| 6 | true | `cla.yml` | `security/cla.yml` (also: ensure `CLA.md` exists at repo root; if missing, copy from `https://github.com/CLDMV/.github/blob/v3/CLA.md` and tell the user to do a legal review) |
| 7 | true | `dependabot-auto-merge.yml` | `automation/dependabot-auto-merge.yml` |
| 8 | true | `release-notify.yml` | `release-companions/release-notify.yml` (also: create empty `.github/release-notifier.yml` and tell the user to add channel config + webhook secrets) |
| 10 | true | `sync-org-labels.yml` | `packaging-docs/sync-org-labels.yml` — **only if this is the org-admin repo** |

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
| `branch-retention.yml` | `automation/branch-retention.yml` (set `exempt_patterns` from Phase 1 Q9) |

---

## Phase 3 — Scaffold

Execute in this order:

### 3.1 — Create the target directory

```bash
mkdir -p .github/workflows
```

If `.github/workflows/` already has files, ask the user whether to **merge** (skip existing template names) or **overwrite** before proceeding.

### 3.2 — Fetch and write each template

For each template selected in Phase 2:

1. Fetch from `https://raw.githubusercontent.com/CLDMV/.github/v3/examples/individual-repo-workflows/<category>/<file>.yml`
2. Write to `.github/workflows/<file>.yml` (drop the category subfolder)
3. Apply the customizations listed in Phase 2 (search/replace `@your-org/your-package` with the actual `package_name` from Q1; toggle inputs for the `meta`-package case)

Use the tool best suited to your environment — `curl` + `Write` works; `git clone` + `cp` works; a single `gh api` call works.

### 3.3 — Apply per-template customizations

- **`package_name` replacement**: every template currently containing `@your-org/your-package` needs to be replaced with the actual value from Q1. Match exactly; the placeholder appears 1× per template that uses it.
- **`meta`-package mode for `publish.yml`** (Q2 = `meta`): set `publish_to_npm: false`, `publish_to_github_packages: false`, `release_source_only: true`, and replace `test_command`/`build_command` defaults with:
  ```yaml
  test_command: "echo '✓ Tests already ran on the PR via ci.yml.'"
  build_command: "echo '✓ No build step for a meta-package.'"
  skip_matrix_tests: true
  skip_performance_tests: true
  min_node_version: ""
  ```
- **`branch-retention.yml`** (from Q9): if the user listed extra branches, set `exempt_patterns: '["master","main","badges","gh-pages","<their-branch>"]'`.
- **`cla.yml`** (Q6): if `CLA.md` doesn't exist, copy from `https://raw.githubusercontent.com/CLDMV/.github/v3/CLA.md` and add a TODO in your final report: "user must review and adapt CLA.md for legal".
- **`release-notify.yml`** (Q8): create `.github/release-notifier.yml` with this stub:
  ```yaml
  channels:
    # Add channel configs here. Each one references a webhook secret you'll
    # add separately in repo Settings → Secrets and variables → Actions.
    # Example for Discord:
    # - type: discord
    #   webhook_secret: DISCORD_RELEASE_WEBHOOK
  ```

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

If the consumer's source layout differs from the org default (`src/`-centric), create `.github/labeler.yml` with custom path → label mappings. See `https://github.com/CLDMV/.github/blob/v3/.github/labeler.default.yml` for the schema.

---

## Phase 4 — Manual steps the user must do

You cannot do these from the CLI. Report them all at the end of your scaffolding run as a single checklist.

### Repo settings (Settings tab)

- [ ] **Settings → Actions → General → Fork pull request workflows from outside collaborators** → set to "Require approval for all outside collaborators"
- [ ] **Settings → Pull Requests → "Allow auto-merge"** → ON *(only if `dependabot-auto-merge.yml` was adopted)*
- [ ] **Settings → Branches → Branch protection rule** on `master`/`main` with at least one required status check (use the `✅ Required PR Check` from `ci.yml`)

### Secrets to add (Settings → Secrets and variables → Actions)

For the bot App attribution (RECOMMENDED — without these, automated PR comments / labels / welcome messages show as `github-actions[bot]`):

- [ ] `CLDMV_BOT_APP_CLIENT_ID`
- [ ] `CLDMV_BOT_APP_PRIVATE_KEY`

For coverage-badge publishing (REQUIRED if `enable_coverage_badge: true`):

- [ ] `CLDMV_BOT_NAME`
- [ ] `CLDMV_BOT_EMAIL`
- [ ] `CLDMV_BOT_GPG_PRIVATE_KEY`
- [ ] `CLDMV_BOT_GPG_PASSPHRASE`

For npm publishing (REQUIRED if Q2 = `npm` and not using trusted publishers):

- [ ] `NPM_TOKEN`

For release notifications (REQUIRED if Q8 = true, one per channel):

- [ ] `DISCORD_<NAME>_WEBHOOK`, `SLACK_<NAME>_WEBHOOK`, etc. — names match `.github/release-notifier.yml` config

### Bot App permissions (Org admin only)

The CLDMV-bot App needs the following permissions added (request from org admin if you don't have access):

- **Organization → Members: Read** — required for `cla.yml`
- **Repository → Issues: Write** — required for `stale.yml`, `master-commit-audit.yml`, `welcome.yml`, `cla.yml`
- **Repository → Pull requests: Write** — required for `labeler.yml`, `welcome.yml`, `dependabot-auto-merge.yml`
- **Repository → Contents: Write** — required for `branch-retention.yml`, `docs.yml`
- **Repository → Packages: Write** — required for `docker-publish.yml`

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

### 5.3 — Commit + open a small test PR

```bash
git add .github/ CLA.md   # CLA.md only if you added it
git commit -m "feat(ci): scaffold CLDMV org workflows (@v4)"
git push -u origin chore/scaffold-workflows
```

Then open a PR titled `chore: scaffold CLDMV workflows` against `master`/`main`. Watch the Actions tab for:

- `🧪 CI Tests & Build` — should run + pass
- `🏷️ PR Labeler` — should fire and label the PR (if any paths match the labeler config)
- `👋 Welcome Contributor` — should NOT fire (you're an existing contributor, not first-time)

If CI passes, the PR is mergeable. Merging triggers the post-merge flow (audit, branch-retention).

---

## Common pitfalls

1. **`enable_coverage_badge` ON but no `badges` branch** — CI's badge-publish step fails. Solution: create the orphan `badges` branch (Phase 3.4).
2. **`docs.yml` adopted but no `npm run docs:build` script** — docs-publish fails. Solution: add the script to `package.json` or change the `build_command` input in `docs.yml`.
3. **`dependabot-auto-merge.yml` adopted but "Allow auto-merge" is OFF** — the auto-merge step fails. Solution: enable in Settings → Pull Requests.
4. **`cla.yml` adopted but the bot App lacks `Organization → Members: Read`** — the org-member exemption fails open (everyone gets prompted to sign). Solution: request the permission from org admin.
5. **Meta-package `publish.yml` left with `publish_to_npm: true`** — npm publish fails because the package isn't real. Solution: re-check Phase 2 customizations.
6. **`package_name` placeholder left as `@your-org/your-package`** — release-PR creation fails with "package not found on npm". Solution: search/replace the placeholder.
7. **Coverage badge secrets missing but `enable_coverage_badge: true`** — coverage-publish step silently downgrades to `github-actions[bot]` and may fail on signed-commit policies. Solution: add the four `CLDMV_BOT_*` GPG secrets OR set `enable_coverage_badge: false`.

---

## References (read these only if needed)

- `https://github.com/CLDMV/.github/blob/v3/examples/README.md` — catalog with summaries
- `https://github.com/CLDMV/.github/blob/v3/examples/guides/WORKFLOW-SETUP-GUIDE.md` — per-template setup details + secrets matrix
- `https://github.com/CLDMV/.github/blob/v3/examples/guides/DRY-RUN-GUIDE.md` — how to test release/publish without making changes
- `https://github.com/CLDMV/.github/blob/v3/examples/guides/UPDATE-MAJOR-VERSION-TAGS-GUIDE.md` — how rolling tags work
- `https://github.com/CLDMV/.github/blob/v3/docs/migration/v2-to-v3.md` — for repos migrating from v2
- `https://github.com/CLDMV/.github/blob/v3/docs/conventions/branch-naming.md` — the branch-name convention `branch-retention.yml` enforces

---

## Final report template

After scaffolding, hand the user this summary (fill in `[brackets]`):

> Scaffolded `[N]` workflows into `.github/workflows/`. Configuration:
> - npm package name: `[name]`
> - package mode: `[npm | meta]`
> - extras adopted: `[docker, bundle-size, docs, cla, etc.]`
>
> ✅ YAML parse passed
> ✅ actionlint passed
> ✅ Test PR opened: `[link]`
>
> **You must still do these manually** (see Phase 4 of `AGENT-SCAFFOLDING.md`):
> - `[N]` repo settings changes (listed)
> - `[N]` secrets to add (listed)
> - `[N]` bot App permissions to request from org admin (listed)
> - `[Y/N]` adapt `CLA.md` for legal review
> - `[Y/N]` add channel config to `.github/release-notifier.yml` with webhook secrets
>
> Re-run me with "verify scaffolding" after you've completed the manual steps to confirm everything is wired correctly.
