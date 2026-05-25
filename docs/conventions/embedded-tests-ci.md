# Embedded private tests in CI

How the CLDMV reusable CI workflow handles private test repositories embedded as anonymous gitlinks in a public parent repo. Companion to the [`@cldmv/git-embedded`](https://github.com/CLDMV/git-embedded) local CLI, which handles the developer-machine side of the same pattern.

## Motivation

Some CLDMV repositories ship public code under an open-source license but keep their full test suite (or other private dependencies — vendor code, license-restricted assets, internal tooling) in separate private repositories. The link between the public parent and the private child is recorded as an **anonymous gitlink**: a `160000` tree entry in the parent that pins the child at a specific commit SHA, without recording the child's URL in `.gitmodules`. The URL stays out of the public parent entirely.

See [`@cldmv/git-embedded`](https://github.com/CLDMV/git-embedded) — and specifically its [`docs/use-case-private-tests.md`](https://github.com/CLDMV/git-embedded/blob/master/docs/use-case-private-tests.md) — for the threat model and the developer-machine workflow.

This document covers only the CI side: how a workflow run on the public parent fetches the private child, runs the full suite, and behaves on fork PRs that have no access.

## Behavior contract

- **Opt-in.** Consumers explicitly enable the feature via a workflow input. The reusable workflow's existing behavior is preserved exactly for repos that don't set the input.
- **Opt-in is one boolean.** No per-gitlink configuration is required for the conventional case. Set `enable_embedded_tests: true` and the workflow auto-discovers gitlinks in the parent's tree and fetches their corresponding private repos via the org bot App.
- **Multiple gitlinks supported.** The workflow iterates every gitlink in the parent's tree; one fetch per. There's no fixed cap.
- **Fork PRs silently skip the fetch.** A pull request from a fork has no access to the bot App's secrets. The workflow detects this case and continues with whatever public test surface exists, without erroring. The maintainer's same-repo branches (and integration branches like `next`/`hotfixes`) run the full suite normally.
- **Detection failure is loud.** If the consumer enabled the input but the workflow couldn't fetch a private repo it was supposed to (e.g., the bot App isn't installed on the private repo, or the pinned SHA doesn't exist there), the workflow fails with a clear error pointing at the resolution.

## URL mapping convention

The mapping is convention-only — no tracked config file. Public-facing tracked configuration would defeat the privacy intent of anonymous gitlinks (it would publish the names and paths of the private repos in the same parent repo that's trying to hide them). The workflow derives every URL from information already implicit in the parent's tree.

Two conventions are supported. The workflow picks between them automatically based on which private repos exist for the parent.

### Primary convention: per-path

Each gitlink path maps to its own private repo, named with the path embedded:

| Gitlink path | Private repo (where `<repo>` = parent's repo name) |
|---|---|
| `tests/` | `<org>/<repo>-tests` |
| `vendor/` | `<org>/<repo>-vendor` |
| `internal/` | `<org>/<repo>-internal` |
| `some/folder/deep/` | `<org>/<repo>-some-folder-deep` |

**Algorithm:**

1. Strip the trailing slash from the gitlink path.
2. Replace every `/` with `-`.
3. Concatenate with the parent's repo name and a `-` separator.

This convention is the default. Each gitlink gets its own private repo, named deterministically from the path.

### Secondary convention: consolidated `<repo>-embedded`

For consumers who'd rather have ONE private repo holding everything (instead of a `-tests` repo plus a `-vendor` repo plus a `-internal` repo plus…), the workflow recognizes a single private repo named `<org>/<repo>-embedded`. Its internal layout mirrors the parent's gitlink paths:

```
<repo>-embedded/
├── tests/                  # contents land at parent's tests/
├── vendor/                 # contents land at parent's vendor/
└── some/
    └── folder/
        └── deep/           # contents land at parent's some/folder/deep/
```

The workflow clones the single `-embedded` repo once and checks out each gitlink's pinned SHA in turn, copying or moving the relevant subdirectory into the parent's gitlink path. *(SHA-pinning semantics: each gitlink in the parent's tree pins to a specific commit of the `-embedded` repo. If the parent has multiple gitlinks pinned to different SHAs of the same `-embedded` repo, the workflow checks out each SHA in turn — the underlying repo is one, but the checkouts are independent.)*

### Convention selection

The workflow decides per-run which convention is in use:

1. Check whether `<org>/<repo>-embedded` exists and is accessible to the bot App.
2. If yes → consolidated convention; all gitlinks fetch from `-embedded`.
3. If no → primary convention; each gitlink fetches from its own `<repo>-<dashed-path>` repo.

Mixed mode (some gitlinks from `-embedded`, others from per-path repos) is not supported. The choice is repo-level, implicit in which private repos the maintainer actually created.

### What this design publishes

The conventions are deterministic and rely only on information that's already public:

- The parent's repo name (public)
- The paths of any gitlinks (visible in the parent's tree)

A reader of the public parent repo can predict the private repo names by applying the convention. That's the same information they already have from the parent's tree — the convention doesn't *add* information, it just reduces guessing. Whether someone *knows* a private repo exists by that name is not the same as having access to it.

If a consumer specifically wants the private repo names to be unguessable (a stronger threat model than this design targets), the right answer is to use unrelated names and skip the auto-fetch entirely — clone the private repos manually in the workflow with hardcoded URLs and the bot token. The convention-based auto-fetch is a convenience layered on top of the anonymous-gitlink primitive; the primitive still works without it.

## Authentication

The CLDMV org bot is a GitHub App that consumers already use for release-flow operations. Fetching private repos uses the same App and the same secrets — `BOT_APP_CLIENT_ID` and `BOT_APP_PRIVATE_KEY` passed via the consumer's `secrets` block, as in the existing reusable workflows.

The App's installation must include the private repos to be fetched. Adding `<repo>-tests` to the App's installation is a one-time setup per private repo; thereafter every consumer using that App can fetch it.

The workflow uses the existing [`actions/github/steps/create-app-token`](../../.github/actions/github/steps/create-app-token/action.yml) composite to mint a short-lived token, then uses that token to clone each private repo. The token expires after the workflow run completes; nothing persists.

## Fork PR behavior

GitHub Actions correctly withholds secrets from workflow runs triggered by `pull_request` events from forks. The workflow detects this via the absence of `secrets.BOT_APP_PRIVATE_KEY` (which evaluates to an empty string in the fork-PR context) and silently skips the fetch step.

The public test surface — anything in `test/`, lint, build, type-check — still runs against the fork's code. The full suite (which depends on the private tests at `tests/`) does not run in the fork's PR. After the maintainer merges to an integration branch (`next` / `hotfixes`), the push event triggers a same-repo run with secrets available, and the full suite runs against the merged code. If the full suite fails, the merge is reverted — recoverable, and the fork PR's code never touched the private tests during its review.

This is the explicit threat-model decision: outside contributors can't run the private tests, by design.

## Failure modes

| Condition | Result | What to do |
|---|---|---|
| Consumer hasn't set `enable_embedded_tests: true` | Workflow runs as if the feature didn't exist | This is the default; no action needed |
| Feature enabled, no gitlinks present in the parent's tree | Step logs "no embedded gitlinks found"; workflow continues | Expected behavior — public-only repos won't have gitlinks |
| Feature enabled, gitlinks present, secrets available | Each private repo is fetched at its pinned SHA, full suite runs | Happy path |
| Feature enabled, gitlinks present, secrets unavailable (fork PR) | Fetch step is skipped silently; public surface runs | Expected — fork PRs run public surface only |
| Feature enabled, gitlinks present, App lacks access to a private repo | Workflow fails with: "App does not have access to <repo>; install the App on that repo" | Install the App on the missing private repo |
| Feature enabled, pinned SHA doesn't exist on the private repo | Workflow fails with: "SHA <sha> not found on <repo>; push the missing commit" | Push the missing commit to the private repo |
| Feature enabled, neither per-path nor `-embedded` repo exists for a gitlink | Workflow fails with: "Expected `<repo>-<path>` or `<repo>-embedded` not found; create one or remove the gitlink" | Create a private repo following one of the two conventions |
| Feature enabled, both per-path AND `-embedded` repos exist | Workflow uses `-embedded` and emits a warning advising the consumer to pick one | Decide on a single convention and remove the duplicate private repo |

## Workflow integration sketch

Implementation is deferred to the next release cut. The integration is two changes plus one new composite action.

### Change 1: `workflow-ci.yml` accepts the input

Add an input to the org-level CI workflow:

```yaml
on:
  workflow_call:
    inputs:
      # ... existing inputs ...
      enable_embedded_tests:
        required: false
        type: boolean
        default: false
        description: "Fetch and run private tests from embedded gitlinks (see docs/conventions/embedded-tests-ci.md)"
```

Pass it through to `reusable-build-and-test.yml`.

### Change 2: build-and-test composite mints token then fetches

The `build-and-test` composite ([`actions/npm/jobs/build-and-test/action.yml`](../../.github/actions/npm/jobs/build-and-test/action.yml)) adds two steps after checkout and before the test runner — minting the App token, then passing it to the fetch action:

```yaml
- name: Create App token (for embedded-tests fetch)
  if: inputs.enable-embedded-tests == 'true'
  id: embedded-tests-token
  uses: CLDMV/.github/.github/actions/github/steps/create-app-token@v4

- name: Fetch embedded private tests
  if: inputs.enable-embedded-tests == 'true'
  uses: CLDMV/.github/.github/actions/github/steps/fetch-embedded-repos@v4
  with:
    token: ${{ steps.embedded-tests-token.outputs.token }}
```

`reusable-build-and-test.yml`'s `build-and-test` job exposes the bot App secrets as env vars (`BOT_APP_CLIENT_ID` / `BOT_APP_PRIVATE_KEY`) at the job level so `create-app-token` picks them up via its existing env fallback. No new secrets plumbing inside the composite itself.

### Change 3: new Node action `fetch-embedded-repos`

Lives at [`actions/github/steps/fetch-embedded-repos/action.yml`](../../.github/actions/github/steps/fetch-embedded-repos/) + `action.mjs`. Implemented as a `using: node24` action (matching the convention used by `sync-pr-labels`, `audit-commit-subject`, `parse-csv-list`, etc.); uses the shared `sh` / `exec` / `getInput` / `setOutput` / `appendSummary` helpers from `common/common/core.mjs` and the `api` / `parseRepo` helpers from `github/api/_api/core.mjs`. Takes a pre-minted token as the `token` input — token minting is the caller's concern (orchestration layer), not the leaf action's.

## Consumer adoption

For a consumer wanting to enable embedded tests on an existing repo:

1. **One-time, in the private tests repo:** install the CLDMV bot App on it (Settings → GitHub Apps → install).
2. **In the public parent repo:** embed the private tests at `tests/` via the [`@cldmv/git-embedded`](https://github.com/CLDMV/git-embedded) CLI (or manually via `git clone <private> tests && git add tests && git commit`).
3. **In the public parent's `.github/workflows/ci.yml`:** add `enable_embedded_tests: true` to the existing call to the CLDMV CI workflow.

No other changes. The workflow auto-discovers the gitlink, derives the URL, fetches the private repo at the pinned SHA, and runs the full suite. Subsequent updates to the tests follow the normal CLI flow: bump the gitlink locally (the dispatcher + hooks handle everything), commit, push. CI picks up the new pin from the gitlink on the next run.

## Migrating existing private-tests setups

Repos already using a different mechanism — submodules with `.gitmodules`, hardcoded paths, separate workflows — can migrate incrementally:

1. Remove the existing private-tests setup (delete `.gitmodules`, remove any per-repo workflow steps).
2. Embed the private repo as an anonymous gitlink (per the `git-embedded` CLI instructions).
3. Add `enable_embedded_tests: true` to the workflow call.

The CLDMV reusable workflow handles the rest. No migration is forced; existing setups continue to work until the maintainer chooses to switch.

## See also

- [`@cldmv/git-embedded`](https://github.com/CLDMV/git-embedded) — the local CLI counterpart
- [`docs/conventions/release-flow-v4.md`](release-flow-v4.md) — the broader release-flow context this fits into
- [`actions/github/steps/create-app-token`](../../.github/actions/github/steps/create-app-token/) — the token-minting action this builds on
- [`actions/github/steps/fetch-embedded-repos`](../../.github/actions/github/steps/fetch-embedded-repos/) — the action that does the work (scaffolded)
