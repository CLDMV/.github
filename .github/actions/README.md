# CLDMV Actions 📦

Reusable GitHub Actions for the CLDMV organization. They are the building
blocks behind the org-level workflows in [`../workflows/`](../workflows/).

## 🏗️ Layout

Actions live under `.github/actions/`, grouped by technology layer:

```
.github/actions/
├── common/      # Cross-cutting steps + the shared lib (common/common/core.mjs)
├── git/         # Local git operations and analysis (audit-commit-subject, branch-retention)
├── github/      # GitHub platform operations
│   └── api/     #   thin REST API wrappers (api/_api/core.mjs is fetch + paginate)
├── npm/         # NPM ecosystem operations (bundle-size)
├── node/        # Node.js environment helpers
├── docker/      # Container image build/publish helpers
├── coverage/    # Coverage badge / PR-comment helpers
├── community/   # 🆕 v3: CLA bot, release notifier — contributor/community-facing actions
├── testing/     # Test-only actions
└── workflows/   # Workflow-level helpers (job summaries, etc.)
```

Within a layer, actions are filed by kind: `steps/` (a single operation),
`jobs/` (a multi-step composite), `api/` (a REST call), `utilities/`.

## ⚙️ How the actions are built

- **Logic lives in Node.** Almost every action is `using: node24` with an
  `action.mjs` entrypoint. The repo ships **no npm dependencies and has no
  build step** — actions use Node built-ins only (`node:fs`, `node:child_process`,
  global `fetch`, …).
- **Composite actions are the exception, not the rule.** An action stays
  `using: composite` only when it must `uses:` another action (a Node action
  cannot). That covers the `checkout-code` / `setup-node` marketplace wrappers,
  `create-app-token` (wraps `actions/create-github-app-token`), and the
  orchestrators in `*/jobs/` that chain several actions together. Even then,
  each orchestrator's own logic is a Node delegation script
  (`run: node "${{ github.action_path }}/<name>.mjs"`), not inline shell.

### Shared library

Import shared helpers rather than duplicating logic:

- `common/common/core.mjs` — `getInput`, `getBooleanInput`, `setOutput`,
  `setOutputs`, `appendSummary`, `getEventPayload`, `exec`, `sh`, `debugLog`.
- `github/api/_api/core.mjs` — `api(method, path, body, { token, owner, repo })`
  (a `fetch` wrapper), `paginate(path, ctx)` (paginated GET with rate-limit
  awareness), and `parseRepo`.
- `git/utilities/git-utils.mjs`, `common/utilities/bot-detection.mjs`, and the
  `github/api/_api/{gpg,tag}.mjs` modules.

`core.mjs`'s `getInput` mirrors `@actions/core`: it reads `INPUT_<NAME>`
(name upper-cased, spaces → `_`), so `using: node24` actions get their declared
inputs for free. Composite delegation steps must instead pass values to the
`.mjs` script via an explicit `env:` block.

## 🔧 Adding or changing an action

1. Put it in the right layer/kind (`common/`, `git/`, `github/`, `npm/`, …).
2. Prefer `using: node24` + `action.mjs`. Use `composite` only if the action
   genuinely needs to `uses:` another action.
3. Import shared helpers from `core.mjs` instead of reimplementing them.
4. Keep `action.yml` inputs/outputs stable — consumers pin these actions by
   tag, and other actions reference them as `@v3`.
5. See [`../instructions/repo-conventions.instructions.md`](../instructions/repo-conventions.instructions.md)
   for tag, signing, API-version, and secret-naming rules.
