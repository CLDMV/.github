# Lint & format: post-merge CI autofix + precommit hook

CLDMV CI applies lint and format fixes **post-merge, on the integration branch** — when a feature PR squash-merges into `next` (or `hotfixes`), CI runs the fixers and commits the result straight back onto that branch. It does **not** run on feature PRs and **not** on the release to `master`. A local **precommit hook** gives developers fast feedback by reporting and failing (never writing). Both are graceful: a repo with no lint/format scripts is unaffected.

## How the CI autofix works

The `lint-format` job (`workflow-ci.yml` → `reusable-lint-format.yml`) runs once (no matrix), gated to **`push` events on `next` / `hotfixes`** only. Four commands, each `npm run <script> --if-present` so a missing script is a no-op:

| Phase        | Default command                     | Input                  | Writes?                |
| ------------ | ----------------------------------- | ---------------------- | ---------------------- |
| Format       | `npm run format --if-present`       | `format_command`       | yes (prettier --write) |
| Lint fix     | `npm run lint:fix --if-present`     | `lint_fix_command`     | yes (eslint --fix)     |
| Format check | `npm run format:check --if-present` | `format_check_command` | no                     |
| Lint check   | `npm run lint --if-present`         | `lint_command`         | no                     |

Flow on a merge into `next`/`hotfixes`: run the two writers; if the tree is now dirty, **commit the fixes back bot-signed** and push onto the branch. That commit re-triggers CI; the next run finds a clean tree, doesn't commit, and converges (no loop). The check phase then fails the integration-branch build only on lint problems `--fix` couldn't resolve — a signal that unfixable code reached `next`.

Because `next` is cleaned at merge time, it's already formatted by the time the `next → master` release ships — so the release needs no lint/format step, and feature PRs aren't gated on style. Skipped on the master-sync push (next just mirrors master) and on `chore: bump version` commits.

Fixer steps are best-effort and never fail the job themselves (`eslint --fix` exits nonzero on an unfixable remainder); the check phase is the authority. Requires the `CLDMV_BOT_*` secrets (already present for the coverage badge) for the signed commit-back, and the bot must be able to push to `next`/`hotfixes`.

Per repo you can: **opt in** by adding `format` / `lint:fix` / `lint` / `format:check` scripts (see the golden-reference `git-embedded`); **override** any command in the repo's `ci.yml` `with:` block (e.g. a monorepo-aware invocation); or **disable** a phase by setting its input to `""`.

## Precommit hook (reports and fails — does not write)

`examples/git-hooks/pre-commit` runs `lint` + `format:check` (check-only) before a commit and **rejects the commit** on any issue — it never modifies your tree. Install it by copying `examples/git-hooks/` into the repo's `.githooks/` and adding a `prepare` script:

```jsonc
{ "scripts": { "prepare": "node .githooks/install.mjs" } }
```

`prepare` fires on `npm install`; `install.mjs` copies `.githooks/pre-commit` into `.git/hooks/pre-commit`.

**Why `.git/hooks` and not `core.hooksPath`:** a per-repo `core.hooksPath` shadows a global `core.hooksPath` dispatcher, silently disabling any global commit policy (no-coauthor / no-unsigned-push) for that repo. A global dispatcher chains to `.git/hooks/<name>`, so installing there composes with global policy. The installer no-ops on CI, inside `node_modules`, and when there's no `.git` directory.

## Debugging a precommit failure

If a commit is rejected by the precommit hook on a CLDMV repo, it is one of these two checks:

- **Format** (`format:check` failed) → run `npm run format` to auto-fix, then re-stage and commit.
- **Lint** (`lint` failed) → run `npm run lint` to see the problems; fix or run `npm run lint:fix`.

Nothing else runs in the hook, so there's no need to hunt further. (CI would auto-apply these same fixes when the change merges into `next` — the hook just keeps unformatted code out of the commit in the first place.)
