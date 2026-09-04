# Package manager: auto-detect, first-class pnpm, and frozen installs

The v4 pipeline resolves which package manager a repository uses and routes every install/run/exec/publish through it. npm, yarn, and pnpm are all first-class. The default is **auto-detect**, so most repos need no configuration; an npm-only repo is unaffected.

## Auto-detection

`package_manager` defaults to **`auto`** across every reusable workflow and composite action. An explicit `npm` / `yarn` / `pnpm` is honored verbatim — detection is skipped. Under `auto`, the manager is resolved from signals in the repository, in this order:

1. the **`packageManager`** field in `package.json` (the corepack standard, e.g. `"packageManager": "pnpm@9.0.0"`) — the primary signal, because workspace repos frequently commit no lockfile in-repo;
2. lockfile / workspace signals — `pnpm-lock.yaml` or `pnpm-workspace.yaml` → **pnpm**; `yarn.lock` → **yarn**; `package-lock.json` or nothing → **npm**.

A repo presenting no pnpm/yarn signal resolves to npm, so existing npm-only repos are unchanged by the `auto` default. Detection reads only the repository's own files — a repo whose pnpm setup lives in an outer/umbrella workspace must expose a local signal (a `packageManager` field is the simplest) for `auto` to pick pnpm.

The single source of truth is `.github/actions/npm/utilities/detect-package-manager` (`resolve.mjs` + a node action that outputs the resolved `package-manager` and a `cache` value for `actions/setup-node`).

## First-class pnpm (and yarn parity)

- **install** — `pnpm install` (`--frozen-lockfile` per the frozen rule below); pnpm/yarn are provisioned via **corepack** (bundled with Node — no third-party action, keeping the Scorecard Pinned-Dependencies check green).
- **run / exec** — script and tool invocations route through the resolved manager (`pnpm run …`, `pnpm exec` / `pnpm dlx`), a no-op for npm.
- **publish** — pnpm uses `pnpm publish`, so `workspace:*` dependencies are rewritten to real versions in the published tarball. npm keeps `npm publish` (with `--provenance` on public packages).
- **setup-node cache** — the cache key is manager-aware for npm/yarn (with a lockfile); pnpm store caching is intentionally left off for now to avoid `actions/setup-node`'s pre-install pnpm ordering failure. This is a caching optimization, not a correctness gap.

## Frozen installs are the CI default

CI installs are **frozen/reproducible** by default — they install exactly the committed lockfile and never mutate it:

| Manager | Frozen (default)                 |
| ------- | -------------------------------- |
| npm     | `npm ci`                         |
| pnpm    | `pnpm install --frozen-lockfile` |
| yarn    | `yarn install --frozen-lockfile` |

A repository on CI is therefore expected to commit its lockfile. If a lockfile is absent, the frozen install fails loudly — that is the intended signal (commit the lockfile), not something to paper over. Metadata-only packages (no dependencies and no lockfile, e.g. this `.github` repo) are detected and skipped, so they never reach a frozen install.

### Opting out: `CLDMV_SKIP_FROZEN_LOCKFILE`

The only way to switch a repository to a plain, lockfile-mutating install (`npm install` / `pnpm install` / `yarn install`) is the repository (or organization) **Actions variable** `CLDMV_SKIP_FROZEN_LOCKFILE`:

```text
# repo Settings → Secrets and variables → Actions → Variables
CLDMV_SKIP_FROZEN_LOCKFILE = 1
```

Set it to a truthy value (`1` / `true` / `yes`) to opt out; unset (the default) means frozen. It is read at every install site — including the release/publish path — via the `vars` context, so no consumer workflow files need editing to use it.

This is a deliberate escape hatch for the rare repository that genuinely cannot commit a lockfile. It is **strongly discouraged**: a non-frozen install is not reproducible and undermines the point of a CI/release pipeline. Prefer committing a lockfile. Do not set this variable unless there is a specific, documented reason to.
