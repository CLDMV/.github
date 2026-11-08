# Package README format

CLDMV package READMEs share one format, which started in `@cldmv/slothlet`. The canonical skeleton is [`examples/readme/README.template.md`](../../examples/readme/README.template.md). Copy it into a repo as `README.md`, replace the placeholders, and delete the optional parts that do not apply.

## Section order

Sections are separated by `---`. Parts marked optional in the template are wrapped in HTML comments or can be dropped whole.

1. `# <package>`, an optional centered banner (`images/<repo>-banner.jpg`), an intro, and a tagline blockquote.
2. Primary badge row: npm version, npm downloads, GitHub downloads, last commit, npm last update, coverage. The GitHub release and release date badges stay in the row as HTML comments.
3. Optional `> [!NOTE]` status callout, then the contributors and sponsor badge row.
4. `## ✨ What's New`: `### Latest: vX.Y.Z (Month YYYY)` with 2-3 bullets plus a changelog link, then `### Recent Releases`, then a closing link to `docs/changelog/`.
5. `## 🚀 Key Features`, `## 📦 Installation` (Requirements, Install), `## 🚀 Quick Start` (ESM first, then a one-line CommonJS note).
6. `## 📚 Configuration`: an options table linking to the full reference. CLI and API tools use `## 💻 CLI` and `## 🔧 API` here instead.
7. `## 📚 Documentation` (Reference, Guides, Repo) followed by the secondary badge row: CodeFactor, OpenSSF Scorecard, npms.io score, npm unpacked size, repo size.
8. `## 🤝 Contributing`, `## 🔗 Links` (npm, GitHub, Issues, Releases), `## 📄 License` (GitHub and npm license badges, then `Apache-2.0 © Shinrai / CLDMV`).
9. The reference-style badge definitions, at the very end of the file.

Release-specific blocks ("Introducing vN") and personal sections (acknowledgments) are not part of the template. Add them to a repo's own README when they apply.

## What's New: Latest plus exactly four Recent Releases

`Latest` carries the current release in 2-3 bullets and links its changelog. `Recent Releases` always has exactly four bullets, newest first, each `**vX.Y.Z** (Month YYYY) — summary (#PRs) ([Changelog](...))`. On every release the previous Latest is promoted into the top Recent bullet and the oldest bullet is dropped. The release-notes work (see the `skill-release-changelog` flow) lands in a separate docs PR into `next` before the release PR ships, as described in [release-flow-v4.md](release-flow-v4.md#55-release-changelog-check--release-changelog).

All links to changelogs and docs are absolute GitHub URLs (`https://github.com/CLDMV/<repo>/blob/<default branch>/...`). Relative links break when the README is rendered on npm.

## Changelog paths

Changelogs live at `docs/changelog/v<major>/vX.Y.Z.md`. Pre-1.0 releases use `docs/changelog/v0/vX.Y.Z.md`. The release changelog check in [release-flow-v4.md](release-flow-v4.md) finds this layout by default.

## Badges

All badges are `img.shields.io` with `style=for-the-badge`, a logo, `logoColor=white`, and a fixed `labelColor` per family:

| Family          | labelColor |
| --------------- | ---------- |
| npm             | `CB3837`   |
| GitHub          | `181717`   |
| CodeFactor      | `F44A6A`   |
| npms.io         | `0B5D57`   |
| GitHub Sponsors | `EA4AAA`   |

OpenSSF Scorecard uses the default colour with `label=OpenSSF Scorecard`. Coverage is a shields `endpoint` badge that reads `coverage.json` from the repo's `badges` branch (written by the coverage job), with the `vitest` logo. Badges are written reference-style: the image definitions and their link targets sit in the footer so the body stays readable.

## Rendering the template

The template is plain Markdown with `{placeholder}` tokens. Replace every token with a global string substitution; there is no templating engine. The values that are derived rather than typed:

| Placeholder                             | Value                                                           |
| --------------------------------------- | --------------------------------------------------------------- |
| `{repo}`                                | GitHub repo name, e.g. `slothlet`                               |
| `{package}`                             | npm name, e.g. `@cldmv/slothlet`                                |
| `{package_encoded}`                     | `encodeURIComponent` of the package, e.g. `%40cldmv%2Fslothlet` |
| `{default_branch}`                      | `master` or `main`                                              |
| `{node_min}`                            | the `engines.node` floor without the operator, e.g. `22.22.0`   |
| `{license}`                             | SPDX id, e.g. `Apache-2.0`                                      |
| `{description}`, `{tagline}`, `{intro}` | prose for the top of the file                                   |

The remaining tokens (`{latest_*}`, `{recent_N_*}`, `{feature_N_*}`, `{option_*}`, `{guide_*}`, `{quick_start_esm}`, `{import_name}`) are content placeholders filled by hand or by the agent writing the README. Tokens use single braces on purpose: double braces are Liquid syntax, and GitHub Pages builds `docs/` with Jekyll, so a doc that quoted them broke every Pages build. The template's code samples contain tokens too, so `.configs/.prettierrc` turns off code-block formatting for `README.template.md`; otherwise prettier would reformat `import {import_name}` into `import { import_name }` and break the token. After substituting, search the result for a leftover token (a `{` directly followed by a name, e.g. `grep -nE '\{[a-z_0-9]+\}' README.md`).

## Not yet automated

`@cldmv/create-scaffold` has no placeholder mechanism (it copies template files verbatim), so a new repo does not get a rendered README from it yet. A conformance check (headings in order, exactly four Recent Releases, badge definitions present with the right colours) is future work.
