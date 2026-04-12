---
applyTo: "**"
---

# Agent Instructions — CLDMV/.github

This repository contains shared GitHub Actions (composite actions, reusable workflows,
and org-wide tooling) for the CLDMV organization.

---

## Rolling Tag Strategy

This repo uses **three-tier semantic version tags**: `vX.Y.Z` (pinned), `vX.Y` (minor rolling),
and `vX` (major rolling). Callers reference `@v2` or `@v2.0` to always get the latest patch.

### ALWAYS use `--force` push for rolling tags — NEVER delete+recreate

**Wrong (creates a gap where the tag doesn't exist):**

```bash
git push origin :refs/tags/v2         # tag is GONE — any workflow resolving @v2 FAILS here
git push origin v2                    # tag comes back
```

**Correct (atomic, tag is always reachable):**

```bash
git push --force origin v2 v2.0
```

The delete+recreate approach causes a race condition: workflows in this repo are triggered by
`push` to version tags and resolve `@v2` at startup. If `v2` is deleted at that moment, the
workflow fails with `failed to fetch workflow: reference to workflow should be either a valid
branch, tag, or commit`.

### Standard release procedure

```bash
# 1. Create pinned tag (signed)
git tag -s vX.Y.Z -m "vX.Y.Z – short description" <commit-sha>

# 2. Update rolling tags (signed, force)
git tag -fs vX.Y -m "vX.Y → vX.Y.Z" <commit-sha>
git tag -fs vX   -m "vX → vX.Y.Z"   <commit-sha>

# 3. Push — pinned tag first, then force-update rolling tags
git push origin master vX.Y.Z
git push --force origin vX vX.Y
```

---

## Workflow Trigger Rules

- **`local-update-major-version-tags.yml`** must only trigger on `push: tags: v[0-9]*`, never on
  bare `push:` or `push: branches:` — firing on master commits races with the tag update window.
- **Example workflows** (`examples/individual-repo-workflows/`) follow the same rule.

---

## API Version

All GitHub REST API calls in this repo use:

```
Accept: application/vnd.github+json
Authorization: Bearer <token>
X-GitHub-Api-Version: 2026-03-10
```

Never use the deprecated `application/vnd.github.v3+json` or `Authorization: token`.

---

## Secret Names

Org-level secrets use the `CLDMV_` prefix. Always use:

- `secrets.CLDMV_BOT_APP_CLIENT_ID`
- `secrets.CLDMV_BOT_APP_PRIVATE_KEY`

Reusable workflows accept them mapped to `BOT_APP_CLIENT_ID` / `BOT_APP_PRIVATE_KEY` via `secrets:` inheritance.

---

## Commit & Tag Signing

All commits and tags must be GPG-signed:

- `git commit -S`
- `git tag -s` (not `-a`)
