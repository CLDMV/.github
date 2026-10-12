# Bot comment commands

A comment on a pull request whose first line is `@cldmv-bot <command> [args]` runs a command as the bot. The logic lives in [`workflow-bot-commands.yml`](../../.github/workflows/workflow-bot-commands.yml); repos carry the thin caller [`automation/bot-commands.yml`](../../examples/individual-repo-workflows/automation/bot-commands.yml).

`issue_comment` workflows always run from the default branch's copy of the caller, never the PR's branch. In the v4 flow a repo therefore gets the commands once the caller reaches `master` through the `next → master` release PR.

## Commands

| Command                        | Effect                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `@cldmv-bot rebase`            | Rebase the PR's head branch onto the current tip of its base branch (`next` / `hotfixes`), keeping only the branch's own commits. |
| `@cldmv-bot rebase from=<sha>` | Same, replaying only the commits after `<sha>` (the branch's old merge-base) with `git rebase --onto <base> <sha>`.               |

Any other word, or a malformed command, gets a short reply listing the supported commands. Matching is on a fixed command table (case-insensitive command word); the comment must start with `@cldmv-bot` and the command must be on the first line.

## `rebase`

The bot checks the head out, runs `git rebase --onto <base tip> <from>` (`<from>` defaults to the base tip, which also drops commits already present upstream), signs the rewritten commits with the bot GPG key (authorship is preserved, the bot is the signing committer) and pushes with `--force-with-lease` pinned to the head commit the rebase started from. The reply on the PR reports the result:

- new head sha and commit count, when the branch was rewritten;
- "already up to date" when the base tip is already an ancestor of the branch;
- the conflicting files when the rebase conflicts. Nothing is pushed in that case.
- a rejected push (the branch moved while the command ran) is reported, not retried. Run the command again.

The comment gets an `eyes` reaction while the command runs, replaced by `+1` on success or `confused` on any other outcome.

### Branches cut before a release

After a `next → master` release, `next` is reset to the squashed release commit, so a branch cut from the pre-release `next` carries all the released commits as its own. The default rebase drops commits whose changes are already in the base where git can tell (identical patches, commits that become empty), but squashed releases often leave conflicts. For this case pass the old merge-base explicitly: `@cldmv-bot rebase from=<sha>`, where `<sha>` is the last pre-release `next` commit the branch was cut from (the parent of the branch's first own commit). Only the commits after `<sha>` are replayed onto the new base, so the released commits drop out.

## Guard rails

- Only commenters with `admin`, `maintain` or `write` permission on the repository (collaborator permission API) act. Others get a one-line refusal.
- Bot comments never trigger commands (the bot's own replies are ignored).
- Fork PRs are skipped with a message: the bot cannot push to a fork's branch.
- Heads named `next`, `hotfixes`, `master` or `main` (input `protected_branches`) and PRs into `master` / `main` (the persistent release PRs) are refused. The bot never rewrites those branches.
- One command at a time per PR (concurrency group `bot-commands-<PR number>`, queued, not cancelled).
- The comment body is untrusted. It is read from the environment only, never interpolated into a script; the command word must match `[A-Za-z-]`, arguments a conservative character set, `from=` a hex sha that must exist and be an ancestor of the branch, and branch names are validated before use. The checkout never executes anything from the PR (git hooks disabled).
- Needs the standard bot secrets: `CLDMV_BOT_APP_CLIENT_ID`, `CLDMV_BOT_APP_PRIVATE_KEY`, `CLDMV_BOT_NAME`, `CLDMV_BOT_EMAIL`, `CLDMV_BOT_GPG_PRIVATE_KEY`, `CLDMV_BOT_GPG_PASSPHRASE`. Without the signing key `rebase` refuses.

## Adding a command

Add the word to the `case` in the "Parse command" step and to the help text, then add the command's own step(s) gated on `steps.parse.outputs.command == '<word>'` after the guard-rails step. Each command writes its reply to `$RUNNER_TEMP/bot-reply.md` and `outcome=ok|fail` to `$RUNNER_TEMP/bot-outcome`; the final step posts the reply and sets the reaction.
