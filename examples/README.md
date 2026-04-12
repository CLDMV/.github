# Examples 📋

This folder contains example configurations for using the CLDMV org-level workflows with the streamlined orchestrator architecture.

## 📖 Guides

- **[WORKFLOW-SETUP-GUIDE.md](WORKFLOW-SETUP-GUIDE.md)** — What each workflow does, which `package.json` scripts it requires, which secrets it needs, and any other prerequisites. Start here when adding a workflow to a new repo.
- **[DRY-RUN-GUIDE.md](DRY-RUN-GUIDE.md)** — How to use dry-run mode to validate release and publish pipelines without making real changes.

## Individual Repository Workflows

The `individual-repo-workflows/` folder contains example workflow files that should be placed in individual project repositories to use the org-level workflows.

### Files:

- **`ci.yml`** - Continuous integration workflow

  - Place in: `.github/workflows/ci.yml` in your project repo
  - Triggers: Push to any branch, PR to master/main
  - Uses: `CLDMV/.github/.github/workflows/workflow-ci.yml@v2`

- **`release.yml`** - Release PR creation workflow

  - Place in: `.github/workflows/release.yml` in your project repo
  - Triggers: Push to non-master/main branches (when you push `release:` or `release!:` commits)
  - Uses: `CLDMV/.github/.github/workflows/workflow-release.yml@v2`
  - **Auto-detects version bump**: Uses `release!:` for major, `release:` + commit analysis for minor/patch

- **`publish.yml`** - Package publishing and release creation workflow
  - Place in: `.github/workflows/publish.yml` in your project repo
  - Triggers: PR closed on master branch (when release PRs are merged)
  - Uses: `CLDMV/.github/.github/workflows/workflow-publish.yml@v2`
  - Creates GitHub releases AND publishes to NPM/GitHub Packages

- **`docker-publish.yml`** - Docker image build and GHCR publish workflow

  - Place in: `.github/workflows/docker-publish.yml` in your project repo
  - Triggers: Push to master/main (and manual dispatch)
  - Uses: `CLDMV/.github/.github/workflows/workflow-docker-publish.yml@v2`
  - Derives image name from root `package.json` and supports optional pre-publish command

- **`update-major-version-tags.yml`** - Floating version tag maintenance workflow
  - Place in: `.github/workflows/update-major-version-tags.yml` in your project repo
  - Triggers: Push to master/main, published releases, and manual dispatch
  - Uses: `CLDMV/.github/.github/workflows/workflow-update-major-version-tags.yml@v2`
  - Keeps `v1`, `v1.2` etc. pointing at the latest release — see [UPDATE-MAJOR-VERSION-TAGS-GUIDE.md](./UPDATE-MAJOR-VERSION-TAGS-GUIDE.md)

### Usage:

1. Copy the workflow files you need to your project's `.github/workflows/` directory
2. Update the `package_name` to match your NPM package name
3. Customize other inputs as needed for your project
4. Commit and push - the workflows will automatically run when triggered

### Customization:

Each workflow accepts various inputs to customize behavior:

- **Node.js version**: Default is `lts/*`, can specify specific versions
- **Package manager**: Default is `npm`, can use `yarn`
- **Commands**: Customize test, lint, build, and other commands
- **Skip options**: Skip certain steps (linting, performance tests, etc.)
- **Publishing options**: Control NPM/GitHub Packages publishing

### Version Bump Auto-Detection:

The release workflow automatically detects the type of version bump from your commit messages:

- **`release!: message`** → **Major version bump** (breaking changes)
- **`release: message`** → Analyzes commit history since last tag:
  - Contains `!` in commits or `BREAKING CHANGE` → **Major**
  - Contains `feat:` commits → **Minor**
  - Only fixes and other changes → **Patch**

You can override this by explicitly setting `version_bump: "major"`, `"minor"`, or `"patch"` in your workflow.

See the org-level workflow files for complete input documentation.
