# Satellite package publishing

Some repositories publish a primary npm package plus one or more **satellite packages** carved from the same build output — slices of the main tarball shipped as separate packages at the **same version, from the same commit**. The canonical case is `@cldmv/slothlet`, which splits its locale JSON into `@cldmv/slothlet-i18n` and its generated declarations into `@cldmv/slothlet-types`.

This document describes how the org publish pipeline (`workflow-publish.yml` → `reusable-publishing.yml`) publishes satellites alongside the core package.

## Model

A satellite is **not** a separately-versioned project. It is a complete, publishable directory produced by the core repo's build, versioned in lockstep with the core. The pipeline treats the directory's own `package.json` as authoritative — no per-satellite version detection, no independent release cadence.

Per core release `vX.Y.Z`, the pipeline produces, for the core and for each satellite:

| Target | Core | Each satellite |
|---|---|---|
| npm | yes | yes |
| GitHub Packages | yes | yes |
| GitHub Release + git tag | `vX.Y.Z` | own prefixed tag at the same commit |
| Rolling `vN` / `vN.Y` tags | yes | no — core only |

Rolling major tags exist so workflow consumers can pin `uses: …@v4`. Nobody pins a git tag to install an npm package, so satellites get only their immutable release tag.

### Satellite tags and releases

The repository has a single git-tag namespace, and `vX.Y.Z` belongs to the core. Satellites therefore use the multi-package convention `@scope/name@version`:

```
@cldmv/slothlet@1.2.3        ← core uses the plain vX.Y.Z scheme (tag: v1.2.3)
@cldmv/slothlet-i18n@1.2.3   ← satellite tag
@cldmv/slothlet-types@1.2.3  ← satellite tag
```

Each satellite gets its own GitHub Release object, signed to match the core's tag signing. The release **body is minimal** — a one-line pointer to the core release — to avoid triplicating an identical changelog at the same version. Each satellite's npm tarball is attached to its release as an asset.

## Discovery: the `extra_packages` input

Satellites are opt-in per repo via a single string input, `extra_packages`, forwarded from `workflow-publish.yml` to `reusable-publishing.yml`. It accepts **either** form, auto-detected:

- **Glob** — one or more whitespace-separated patterns. Matching is deliberately simple: a single `*` wildcard in the **final** path segment (e.g. `dist-packages/*` or `dist-packages/slothlet-*`); `**`/nested globs are not supported and `?` matches a literal `?`. Every matching directory that contains a `package.json` is published.

  ```yaml
  extra_packages: "dist-packages/*"
  ```

- **JSON array** — explicit `{ name, dir }` entries, when a repo wants to publish only a curated subset.

  ```yaml
  extra_packages: |
    [
      { "name": "@cldmv/slothlet-i18n",  "dir": "dist-packages/slothlet-i18n" },
      { "name": "@cldmv/slothlet-types", "dir": "dist-packages/slothlet-types" }
    ]
  ```

A leading `[` or `{` selects JSON; anything else is treated as a glob. Empty (the default) disables the feature entirely — every repo that does not produce satellites is unaffected.

Satellite name and version are read from each directory's `package.json`; the version is asserted equal to the core version (lockstep).

## Where satellites come from: the build artifact

The publish jobs do not run against the repo checkout. `build-and-test` runs `npm pack`, expands the tarball into `package-contents/`, and uploads it as the build artifact; the publish jobs download that artifact and publish from it. Satellites ride the same mechanism:

1. The carve runs during the build and populates `dist-packages/<name>/`, each a complete publishable package with the version stamped to core.
2. `build-and-test` includes `dist-packages/` in the uploaded artifact (no-op when the directory is absent).
3. The satellite jobs download the same artifact and publish each `dist-packages/<name>/` directory.

This guarantees satellites are slices of the **tested** build output at the same commit, never a separate rebuild.

### Running the carve

Two supported paths; pick whichever suits the repo:

- **Fold it into `build_command`** — the repo's build script leaves `dist-packages/` populated. The workflow stays package-agnostic.
- **`build_subpackages_command` input** — an optional command the workflow runs after the build step, for repos that prefer to keep the carve separate from their main build.

Either way the contract is the same: by artifact-upload time, `dist-packages/<name>/` exists and is publishable.

## Auth, provenance, and channels

Satellites reuse the core's auth and registry wiring verbatim:

- **npm** — same `NPM_TOKEN` / OIDC trusted-publisher path as core. Token absent ⇒ OIDC ⇒ provenance, matching core automatically.
- **GitHub Packages** — same `--access` (derived from repo visibility) and `GITHUB_TOKEN`.
- **dist-tag / channel** — satellites inherit the core's dist-tag. There is no separate prerelease/beta channel for satellites.

Idempotency is inherited from the publish step: a re-run of a version already on the registry is a pseudo-success (skip), so re-running a release after fixing one satellite safely republishes only what is missing.

### First publish of a new satellite name

OIDC trusted publishing cannot bootstrap a name npm has never seen. For each new satellite:

1. Publish the first version once with a granular `NPM_TOKEN` (a one-shot dispatch, or locally).
2. On npmjs, configure the trusted publisher → repo `CLDMV/<repo>`, the publish workflow.
3. Subsequent releases publish via OIDC with provenance, token-less, matching core.

For provenance to validate, each satellite `package.json` **must** set `repository` (with `repository.directory`) pointing at the core repo. This also links the GitHub Packages entry to the repo.

GitHub Packages needs no equivalent bootstrap — a new scoped name publishes on first push with `packages: write`.

## Failure semantics

The satellite matrix runs **after** the core publish and release, with `fail-fast: false`. A satellite failure:

- never rolls back or blocks the core release, which has already succeeded;
- does not cancel sibling satellites;
- marks the overall run failed (red) so it is visible and retryable.

Because publish is idempotent, re-running the release republishes only the satellite that failed. For this to hold, satellite discovery and publishing are deliberately **not** gated on the core version. The core publish/release jobs skip cleanly when `version == npm-latest` (nothing new to ship), but the satellite jobs must not borrow that gate: once the core is published, a re-run to recover a failed satellite *also* has `version == npm-latest`, and a core-keyed gate would skip the satellites and strand the failure. Instead the satellite matrix always re-enters, and each leg's own idempotency (already-published version ⇒ pseudo-success skip; tag/release creation upsert) makes the re-run a no-op for the satellites already out and a real publish for the one(s) missing — on either "re-run all jobs" or a fresh trigger. The trade-off is that satellite discovery runs on every publish trigger (not only on version bumps); on an unchanged version this is a green no-op, not a failure.

## Rollout

Adding an input that flows entry → reusable is two-phase, because this repo publishes itself and `@v4` only rolls forward *after* a publish run completes:

- **Release 1** ships everything except the `workflow-publish.yml` surface: the `reusable-publishing.yml` inputs and jobs, the `package-dir` action support, the create-release tag override, and `dist-packages/` in the artifact.
- **Release 2** (after `@v4` includes Release 1) adds `extra_packages` and `build_subpackages_command` to `workflow-publish.yml` and forwards them. Consumers adopt after Release 2.
