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

A brand-new satellite name must be bootstrapped with a one-time manual first publish before it can be released automatically — set this up before the first release, not after one half-fails. See [Bootstrapping a new satellite (first publish)](#bootstrapping-a-new-satellite-first-publish).

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

For provenance to validate, each satellite `package.json` **must** set `repository` (with `repository.directory`) pointing at the core repo. This also links the GitHub Packages entry to the repo.

Idempotency is inherited from the publish step: a re-run of a version already on the registry is a pseudo-success (skip), so re-running a release after fixing one satellite safely republishes only what is missing.

## Bootstrapping a new satellite (first publish)

npm's OIDC trusted publishing **cannot create a package name it has never seen** — there is no initial-publish-over-OIDC yet (tracked in [npm/cli#8544](https://github.com/npm/cli/issues/8544), still open as of 2026-06). And both the npmjs.com UI and the `npm trust` CLI **require the package to already exist** before a trusted publisher can be configured for it — there is no way to pre-register one against a name npm has never seen. So each brand-new satellite *name* needs a **one-time, manual first publish** to create the package; every release after that is automated and token-less via OIDC, in lockstep with the core.

Do this **before** the satellite's first release — not after a release half-fails on a name npm can't create. It is per brand-new name only: existing satellites need nothing, and a satellite leg that fails mid-release is recoverable by simply re-running, since the satellite jobs are not gated on the core version and every publish step is idempotent (see [Failure semantics](#failure-semantics)).

**Prerequisites.** An npm account with **write access to the `@scope`** (standard Developer-team membership in the npm org) and **account-level 2FA enabled** — trusted-publishing setup mandates 2FA, and granular tokens configured to bypass 2FA are not accepted for it.

Then, once per new satellite name:

```bash
# 1. Build + carve so dist-packages/<name>/ exists (however the repo runs the carve).
#    Each satellite's package.json needs a `repository` field (required for provenance —
#    see Auth, provenance, and channels). Access is NOT read from package.json: the
#    workflow derives --access from repo visibility, and the bootstrap sets it in step 3.
npm run build:ci && npm run build:subpackages

# 2. The carve stamps the satellite at the current core version. Drop the bootstrap
#    publish to a throwaway version so it can't collide with the upcoming real release
#    or claim the `latest` dist-tag:
#       edit dist-packages/<name>/package.json  →  "version": "0.0.0"

# 3. Authenticate (interactive login prompts for the 2FA OTP; a granular publish token
#    also works) and publish ONCE — on a non-latest tag — to CREATE the package. Pass
#    --access explicitly to match how the workflow publishes (it derives --access from
#    repo visibility): `public` for a public package, `restricted` for a private one.
npm login
npm publish ./dist-packages/<name> --tag bootstrap --access public

# 4. Now that the package exists, register the trusted publisher (npm >= 11.10.0,
#    released 2026-02 — or npmjs.com → the package → Settings → Trusted publishing).
#    A permission flag (--allow-publish) is REQUIRED; the command fails without one.
npm trust github @scope/<name> \
  --repository <owner>/<repo> \
  --file <publish-workflow>.yml \
  --allow-publish
#    Add --environment <env> if the publish job runs in a named GitHub environment.

# 5. Verify.
npm view @scope/<name> version
npm trust list @scope/<name>
```

A satellite's trusted-publisher values mirror the core package's: satellites publish through the identical workflow in the same repo, so set `--repository` / `--file` (and `--environment`, if the job uses one) to match the core package's own trusted-publisher configuration — that pairing already works for the core.

From the next release on, the workflow publishes that satellite over OIDC with provenance, at the core version, alongside the core. The throwaway `0.0.0` / `bootstrap` publish is harmless: the first real release publishes the lockstep version and takes `latest`; drop the placeholder afterwards with `npm dist-tag rm @scope/<name> bootstrap` if you like.

GitHub Packages needs no equivalent bootstrap — a new scoped name publishes on first push with `packages: write`.

When npm ships initial-publish-over-OIDC ([npm/cli#8544](https://github.com/npm/cli/issues/8544)), this manual step goes away — you'll register the trusted publisher first and let the first release create the package. Until then, the manual first publish is required.

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
