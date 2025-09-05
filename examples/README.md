# Examples 📋

This folder contains example configurations for using the CLDMV org-level workflows with the streamlined orchestrator architecture.

## Individual Repository Workflows

The `individual-repo-workflows/` folder contains example workflow files that should be placed in individual project repositories to use the org-level workflows.

### Files:

- **`ci.yml`** - Continuous integration workflow

  - Place in: `.github/workflows/ci.yml` in your project repo
  - Triggers: Push to any branch, PR to master/main
  - Uses: `CLDMV/.github/.github/workflows/ci.yml@v1`

- **`release.yml`** - Release PR creation workflow

  - Place in: `.github/workflows/release.yml` in your project repo
  - Triggers: Push to non-master/main branches (when you push `release:` or `release!:` commits)
  - Uses: `CLDMV/.github/.github/workflows/release.yml@v1`
  - **Auto-detects version bump**: Uses `release!:` for major, `release:` + commit analysis for minor/patch

- **`publish.yml`** - Package publishing and release creation workflow
  - Place in: `.github/workflows/publish.yml` in your project repo
  - Triggers: PR closed on master branch (when release PRs are merged)
  - Uses: `CLDMV/.github/.github/workflows/publish.yml@v1`
  - Creates GitHub releases AND publishes to NPM/GitHub Packages

### Usage:

1. Copy the three workflow files to your project's `.github/workflows/` directory
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
