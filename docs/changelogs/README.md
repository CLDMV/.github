# Changelogs

Per-release changelogs for `@cldmv/.github`. **One file per minor version** (`vX.Y.0`) covering only what shipped in that minor cut — patch releases inside a minor (`vX.Y.1`, `vX.Y.2`, …) don't get their own file; their details live in the corresponding GitHub Release. Major versions are also minors (`v3.0.0` is documented in `v3.0.0.md`).

## Scope rules

- Changes that ship in v2 stay in their `v2.x.0.md` — they don't roll forward into `v3.0.0.md`.
- A `vX.Y.0.md` covers commits between the previous minor (`vX.(Y-1).0` or the last patch of the prior major) and itself.
- A `vX.0.0.md` covers commits between the previous major's final tag and itself.
- Patch-only releases (e.g. v2.0.1 → v2.0.39) are summarized in a short trailing section of the parent minor's file rather than getting their own files.

## Index

| Version | Date | Headline |
|---|---|---|
| [v3.0.0](v3.0.0.md) | 2026-05-20 | Security baseline, automation suite, dogfood workflows, CLA bot, branch retention |
| [v2.0.0](v2.0.0.md) | 2026-04-11 | `@v1`→`@v2` ref bump, GitHub App `client-id` migration, coverage badge in PR descriptions, Node 24 runtime |
| [v1.0.0](v1.0.0.md) | 2025-08-05 | Initial release — CI / release / publish / tag-management workflows |

Minor releases between the entries above (v1.1 through v1.12) don't yet have their own files — see the corresponding GitHub Releases for now. They can be backdated on request.

## Conventions

- Sections: **Breaking changes**, **Added**, **Changed**, **Fixed**, **Removed**. Skip sections with no entries.
- Each bullet ends with a parenthetical commit/PR reference when easily linkable.
- The release-flow bot (`reusable-release-management.yml@v3`) generates GitHub Release notes automatically for every patch. This folder is the curated long-form companion for the minor cut.
