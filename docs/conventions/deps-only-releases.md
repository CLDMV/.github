# Deps-only releases

A pending `next → master` (or `hotfixes → master`) range is classified as **deps-only** when nothing a consumer installs or runs has changed. Such a range is held: the release PR is labeled `release: deps-only` and the release-merge workflow refuses to merge it. Bumps keep landing on `next` as usual and nothing is ever committed to `master` for them. When a real change joins the range the label is removed on the next refresh and the PR is an ordinary release again.

## What counts as deps-only

Every file changed in `<merge-base>..HEAD` must be one of:

- a lockfile: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` (`npm-shrinkwrap.json` is **not** included because it ships with the package),
- CI configuration under `.github/` (workflows, `dependabot.yml`, actions),
- the root `package.json`, where the only fields that differ between the merge-base and `HEAD` are `devDependencies` and `version`. A change to `dependencies`, `peerDependencies`, `optionalDependencies`, `files`, `exports`, `bin`, `scripts`, `engines` or any other field makes the range a normal release.

Anything else (shipped source, tests, docs, a changelog file, configs outside `.github/`) also makes the range a normal release. A docs-only range is therefore not deps-only; a changelog doc PR joining the range is the usual way a deps-only range becomes a real release. An explicit `release:` commit in the range is a maintainer asking for a release and is never held. If the range cannot be classified (missing ref, no root `package.json`) it is treated as a normal release.

The check compares manifest fields; it does not run `npm pack`.

## What the pipeline does

- `check-release-commit` computes the verdict and exposes it as the `deps-only` output (`true`/`false`). `create-release-pr` and `update-release-pr` re-expose it as their own `deps-only` output.
- Both actions add the `release: deps-only` label to the release PR when the verdict is `true`. The label is in the managed-label set, so a refresh removes it as soon as the verdict flips to `false`. Tooling that lists release PRs (for example the gh-broker `report_release_prs` verb) can read the label to tell a held PR from a releasable one.
- `release-merge` skips any PR carrying the hold label, even with a standing approval and green checks, and writes a job summary line. The label name is the `hold_label` input of `workflow-release-merge.yml` (default `release: deps-only`).

## Decisions

- **The version-bump commit is unchanged.** The `chore: bump version` commit still lands on `next` for a deps-only range. Skipping it would change the version-resolution path and the "already bumped" detection that the refresh relies on; the bump commit is itself ignored by the classifier (`version` and lockfiles are allowed), so keeping it is harmless.
- **Hold by label, not draft.** A draft release PR cannot be re-readied by the same bot refresh without a GraphQL call, and the release PR is persistent; a label plus a merge gate keeps the PR visible and updatable.
- **Overriding.** A maintainer who really wants to ship a deps-only range can merge the PR by hand; the next refresh would only re-add the label if the PR were still open.

## Rollout note

The classifier lives in the existing `check-release-commit` action and the label logic in the existing `create-release-pr` / `update-release-pr` actions, all of which `workflow-next-release.yml` and `workflow-hotfixes-release.yml` already reference at `@v4`. No new action is referenced from a release-opener workflow, so no pin-then-flip is needed. Callers of `workflow-release-merge.yml` pick up the hold with the next `@v4` roll.
