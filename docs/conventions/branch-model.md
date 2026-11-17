# Branch model custom property

Every CLDMV repo records where its work lands in an org custom property, `branch-model`. Tools, sweeps and agents read it instead of guessing from branches and workflow files, which has gone wrong before (fleet sweeps opening PRs into `next` on dev-trunk repos).

## Values

The property is a single select with no default, so an unset repo stays distinguishable from a deliberate `none` and shows up in a backfill check.

| Value       | Meaning                                                                  | Work lands on              |
| ----------- | ------------------------------------------------------------------------ | -------------------------- |
| `v4`        | `next` / `hotfixes` → `master` with the CLDMV/.github v4 workflows       | `next` (fixes: `hotfixes`) |
| `dev-trunk` | v4 scaffold on `master` / `next`, real work on a persistent `dev` branch | `dev`                      |
| `legacy`    | an older flow of its own that is still active                            | per repo                   |
| `custom`    | a deliberately bespoke setup (for example clients-timelesswines.com)     | per repo                   |
| `none`      | no active release flow: empty, archived, docs or scratch repos           | —                          |

## Reading it

`GET /repos/{owner}/{repo}` returns the value under `custom_properties`, and `GET /repos/{owner}/{repo}/properties/values` returns it on its own. `GET /orgs/{org}/properties/values` lists every repo's values at once. A sweep picks its target branch from the value and skips `legacy`, `custom` and `none` repos.

## Who sets it

`v4-bootstrap.yml` takes a `branch_model` input (default `v4`) and records it in its `settings` phase. A dev-trunk onboarding passes `dev-trunk`. The `org-bootstrap-repo` action itself defaults to leaving the property alone, so the org onboarding fanout never relabels a mixed set of repos.

Before any phase runs, the bootstrap reads the property. A repo marked `legacy` or `custom` is skipped entirely, since the v4 rulesets and settings would break its own flow, and so is a run that asks to record either of those values. Set the `force` input to bootstrap one anyway; the run then warns that it overrode the guard.

Everything else is set by hand in the org settings or by the dispatch-only backfill in the private internal-github-tools repo, which applies a checked-in `data/branch-model.json` map.

## One-time setup

- Define the property at `https://github.com/organizations/<org>/settings/custom-properties`: name `branch-model`, type single select, allowed values `v4`, `dev-trunk`, `legacy`, `custom`, `none`, no default value, not required.
- Grant the bot App the organization **Custom properties** permission (read and write) and approve the updated permissions on the installation.

Until both are in place the bootstrap warns that it couldn't read or write the property and carries on; nothing fails.
