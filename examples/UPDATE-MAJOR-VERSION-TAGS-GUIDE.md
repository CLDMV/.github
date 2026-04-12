# 🏷️ Update Major Version Tags Guide

The `update-major-version-tags.yml` workflow automatically maintains **floating version tags** (e.g. `v1`, `v1.2`) that always point to the latest release within their version range. This is the same pattern used by GitHub Actions — `uses: CLDMV/.github/.github/workflows/workflow-ci.yml@v2` works because `v1` is a floating tag.

## 🎯 What Are Floating Tags?

When you publish a release `v1.2.3`, callers who pin to `@v1` or `@v1.2` should automatically get it. This workflow keeps those floating tags in sync:

| Tag | Points to |
|---|---|
| `v1` | Latest release across all `v1.*.*` versions |
| `v1.2` | Latest release within `v1.2.*` |
| `v1.2.3` | Exact release (never moved) |

## 🚀 Quick Setup

### 1. Copy the Workflow File

Copy `individual-repo-workflows/update-major-version-tags.yml` to your repo:

```bash
cp examples/individual-repo-workflows/update-major-version-tags.yml \
  .github/workflows/update-major-version-tags.yml
```

### 2. Configure Org Secrets

The following secrets must be set at the org (or repo) level:

| Secret Name | Description |
|---|---|
| `CLDMV_BOT_APP_ID` | GitHub App ID used to mint tokens for tagging |
| `CLDMV_BOT_APP_PRIVATE_KEY` | Private key for the GitHub App |
| `CLDMV_BOT_NAME` | Git author name for signed tags (e.g. `CLDMV Bot`) |
| `CLDMV_BOT_EMAIL` | Git author email for signed tags |
| `CLDMV_BOT_GPG_PRIVATE_KEY` | GPG private key for signing tags |
| `CLDMV_BOT_GPG_PASSPHRASE` | Passphrase for the GPG key |

GPG signing is enabled by default. If you don't have GPG secrets, set `use_gpg: false` (see [Skipping GPG Signing](#-skipping-gpg-signing) below).

### 3. Commit and Push

```bash
git add .github/workflows/update-major-version-tags.yml
git commit -m "ci: add update-major-version-tags workflow"
git push
```

The workflow runs automatically on every push to `main`/`master` and on every published release.

---

## 🔄 When Does It Run?

| Trigger | When |
|---|---|
| `push` to `main`/`master` | Every time commits land on the default branch |
| `release` published | Every time a GitHub Release is published |
| `workflow_dispatch` | Manually, from the Actions tab |

The most common trigger is publishing a release — after `v1.2.3` is created, the workflow moves `v1.2` and `v1` to point at the same commit.

---

## ⚙️ Configuration Inputs

All inputs are optional with sensible defaults.

### Behavior Inputs

| Input | Default | Description |
|---|---|---|
| `debug` | `false` | Enable verbose logging in the Actions tab |
| `create_documentation` | `false` | Create/update a `VERSION_TAGS.md` file documenting all floating tags |
| `use_gpg` | `true` | Sign tags with the bot GPG key |

### Safety Limits

These prevent runaway tag processing on repos with large tag histories:

| Input | Default | Description |
|---|---|---|
| `max_tags` | `100` | Maximum total tags to process |
| `max_major_versions` | `10` | Maximum distinct major versions (e.g. v1, v2, …) |
| `max_minor_versions` | `10` | Maximum minor versions per major (e.g. v1.0, v1.1, …) |

### Tag Filtering

| Input | Default | Description |
|---|---|---|
| `include_patterns` | `["v*"]` | JSON array of glob patterns — only matching tags are processed |
| `exclude_patterns` | `[]` | JSON array of glob patterns — matching tags are skipped |
| `bot_patterns` | `["CLDMV Bot", "cldmv-bot", "github-actions[bot]"]` | JSON array of name patterns that identify bot-created tags |

---

## 📋 Common Scenarios

### Standard Release Flow

No manual configuration needed. Push a tag and publish a release:

```bash
git tag -s v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

Then publish the GitHub Release — the workflow runs automatically and updates `v1.2` and `v1`.

### Generate Version Documentation

Enable `create_documentation` to have the workflow maintain a `VERSION_TAGS.md` file in your repo listing all floating tags and what they resolve to. Do this via manual dispatch:

1. Go to **Actions → 🏷️ Update Major Version Tags → Run workflow**
2. Set `create_documentation` to `true`
3. Click **Run workflow**

### Skipping GPG Signing

If you don't have GPG secrets configured, dispatch with `use_gpg` set to `false`:

```yaml
# In your workflow file, change the default:
use_gpg:
  default: false
```

Or override at dispatch time via the Actions UI.

### Processing Only Specific Tag Patterns

To only manage `release-*` tags instead of `v*`:

```yaml
with:
  include_patterns: '["release-*"]'
```

To exclude pre-release tags:

```yaml
with:
  exclude_patterns: '["*-alpha*", "*-beta*", "*-rc*"]'
```

---

## 🔍 Understanding the Output

A successful run looks like this in the Actions log:

```
🏷️ Processing v1.2.3 → updating v1.2 and v1
✅ Tag v1.2 → abc1234 (was def5678)
✅ Tag v1 → abc1234 (was def5678)
🎉 Updated 2 floating tags
```

With `create_documentation: true`, a `VERSION_TAGS.md` is committed to your default branch with a table of all floating tags.

---

## 🛠️ Troubleshooting

### Tags Not Updating

**Symptom**: Workflow runs but floating tags don't move.

- Verify your release tag matches the `include_patterns` (default: `v*`).
- Check that the tag is semver-compatible (`vMAJOR.MINOR.PATCH`).
- Enable `debug: true` for detailed processing logs.

### GPG Signing Failures

**Symptom**: Workflow fails with `gpg: signing failed`.

- Confirm `CLDMV_BOT_GPG_PRIVATE_KEY` and `CLDMV_BOT_GPG_PASSPHRASE` are set and correct.
- Temporarily set `use_gpg: false` to verify the rest of the workflow works.

### Missing Permissions Error

**Symptom**: `Resource not accessible by integration` or `403` on tag push.

- Verify `CLDMV_BOT_APP_ID` and `CLDMV_BOT_APP_PRIVATE_KEY` are set.
- The GitHub App must have **Contents: Write** permission on the repo.

### Safety Limit Hit

**Symptom**: Workflow stops early with a message about exceeding `max_tags`.

- Increase `max_tags`, `max_major_versions`, or `max_minor_versions` to suit your repo.
- Use `exclude_patterns` to skip old tags you no longer want managed.

---

## 💡 Pro Tips

- **Pair with `publish.yml`**: The publish workflow creates patch tags (`v1.2.3`); this workflow handles the floating ones — together they give consumers reliable `@v1` pins.
- **Run on pushes too**: The default triggers include branch pushes so floating tags stay current even without a formal release.
- **Use `include_patterns` strictly**: On repos with tag clutter, filtering to only `v*` prevents unrelated tags from slowing the workflow.
- **Trust the safety limits**: The defaults (`max_tags: 100`, `max_major_versions: 10`) cover nearly all real-world repos. Only raise them if you see the limit warning in logs.
