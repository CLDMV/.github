# Fleet .gitignore templates

One `.gitignore` per language for CLDMV repos. Only Node exists so far: [`Node.gitignore`](./Node.gitignore).

## What's in it

The file is one managed block between two markers:

```gitignore
# >>> CLDMV fleet (Node) >>>
…
# <<< CLDMV fleet <<<
```

Inside it, in order:

- GitHub's [Node.gitignore](https://github.com/github/gitignore/blob/main/Node.gitignore), verbatim. The commit it was copied from is in the section header; refresh it from upstream rather than editing it.
- CLDMV conventions: `tmp/`, `trash/`, root `coverage/` and `logs`, `dist/`, `types/`, `/bin/` and the vitest-runner coverage scratch folders. Upstream's unanchored `coverage` and `logs` would also match source folders like `src/api/logs/`, so this section re-includes them and ignores only the root ones.
- Editor and OS files, including `.vscode/` and `.idea/`.
- OS duplicate names (`file copy.js`, `dir copy (2)/`) and `*.backup*` / `*.bak`.
- AI and agent tool files. These are anchored to the repo root, so generic names such as `/tasks/`, `/config.yml` or `/prompts/` never hide a source folder.

## Using it in a repo

Copy the block to the top of the repo's `.gitignore`. Anything the repo needs on top of it goes below the closing marker, including `!` lines that re-include something the block ignores. Don't edit inside the markers; the packrat sweep (CLDMV/packrat#8) rewrites the block in place when this template changes.

A `.gitignore` only affects untracked files. After adding or updating the block, list the tracked files it now matches:

```bash
git ls-files -ci --exclude-standard
```

Untrack the ones that really are artifacts or tool files (`git rm --cached <path>` keeps them on disk). Anything that is real source should move to where the conventions put it (for example a CLI from `bin/` to `src/bin/`, see [package-layout.md](../../docs/conventions/package-layout.md)) rather than being re-included.
