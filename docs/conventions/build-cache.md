# Build cache

An opt-in cache around the build step, for repos whose build produces something expensive that rarely changes: a compiled wasm module, a downloaded compiler toolchain, generated code. Two inputs turn it on; without them nothing changes.

## Inputs

| Input                   | Default | Meaning                                                                                                                         |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `build_cache_paths`     | `""`    | Multiline list of paths to cache (`actions/cache` `path` syntax). Empty = no cache step at all.                                 |
| `build_cache_key_files` | `""`    | Multiline globs whose file contents key the cache. Change one of these files and the next build starts from an empty cache dir. |

```yaml
jobs:
  ci:
    uses: CLDMV/.github/.github/workflows/workflow-ci.yml@v4
    with:
      package_name: "@cldmv/lib-sqlite-wasm"
      build_cache_paths: |
        .cache/toolchains
        .cache/build
      build_cache_key_files: |
        sqlite.version.json
        src/c/**
        scripts/build-wasm.mjs
```

The cached paths must be gitignored. They are restored into the working tree before the build, and the release-PR jobs commit from that working tree.

## Where it applies

Every job that runs a build restores before it and saves right after it:

| Entry point                                                       | Jobs                                                                                      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `workflow-ci.yml`                                                 | the Node matrix legs, the type-check job, the coverage-badge and coverage-PR-comment legs |
| `reusable-bundle-size.yml` (called directly by `bundle-size.yml`) | the HEAD and BASE builds                                                                  |
| `workflow-next-release.yml`, `workflow-hotfixes-release.yml`      | the release-PR create and refresh builds                                                  |
| `reusable-publishing.yml`                                         | the create-release build                                                                  |

`workflow-publish.yml` doesn't forward the inputs yet. This repo publishes itself through `workflow-publish.yml`, which calls the reusables at `@v4`, and passing an input that the current `@v4` reusable doesn't declare fails the run. The forwarding lands in the release after the reusables ship (the same two-phase rollout as [satellite packages](satellite-packages.md#rollout)).

## Key

```text
<runner.os>-<runner.arch>-cldmv-build-<sha256>
```

The hash covers, in order: a layout version, the build command of the job, the cached paths, and the repo-relative path and SHA-256 content hash of every file the key globs match (sorted). So:

- jobs that run the same build command share one entry (all the matrix legs, for example), and jobs with a different command (`npm run build:ci` on the matrix, `npm run build` on the coverage legs) keep their own;
- the Node version isn't part of the key. Don't cache output that depends on it (a native addon built per Node ABI);
- only an exact key match restores. There's no prefix fallback, so a build never starts from output keyed to different inputs.

The files are matched and hashed by the action itself (`.github/actions/common/steps/build-cache/build-cache.mjs`), not by `hashFiles()`. `hashFiles()` takes its patterns as separate comma-separated arguments, and a multiline input can't be split into arguments in an expression. Glob syntax per line:

- `*` matches within one path segment, `**` across segments, `?` one character, `{a,b}` either alternative;
- a line starting with `!` excludes what it matches; `#` lines are comments;
- a pattern that names a directory covers every file under it;
- `.git` is never walked, and `node_modules` only when the pattern names it.

If no file matches, the run logs a warning: the key then only changes with the build command and the paths, so a stale cache would never be replaced.

## When it saves

Restore runs on every event. Save runs only on a `push` to the default branch, `next` or `hotfixes`, and only when the restore missed (an existing key can't be overwritten). Pull request runs restore what those branches saved but never add entries of their own, so PR caches don't pile up against the repo's cache quota.

Save runs straight after the build step, so a test failure later in the job doesn't lose the cache. When several matrix legs miss at once, the first save wins and the others log a warning that the key already exists.

A failure while planning the key (an unreadable key file, say) logs a warning and turns the cache off for that run. The build itself still runs.

## Action

All jobs go through one composite, `.github/actions/common/steps/build-cache`, which wraps `actions/cache/restore` and `actions/cache/save`:

```yaml
- name: Restore build cache
  id: build-cache
  if: ${{ inputs.build_cache_paths != '' }}
  uses: CLDMV/.github/.github/actions/common/steps/build-cache@v4
  with:
    mode: restore
    paths: ${{ inputs.build_cache_paths }}
    key-files: ${{ inputs.build_cache_key_files }}
    build-command: ${{ inputs.build_command }}

- name: Build
  run: npm run build

- name: Save build cache
  if: ${{ steps.build-cache.outputs.save == 'true' }}
  uses: CLDMV/.github/.github/actions/common/steps/build-cache@v4
  with:
    mode: save
    paths: ${{ inputs.build_cache_paths }}
    key: ${{ steps.build-cache.outputs.key }}
```

Restore outputs `enabled`, `key`, `cache-hit` and `save`.
