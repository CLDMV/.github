# CLDMV GitHub Organization Workflows 🚀

This repository contains streamlined GitHub Actions workflows using a modular orchestrator pattern for the CLDMV organization.

## 📋 Quick Start

1. **Copy example workflows** from [`examples/individual-repo-workflows/`](examples/individual-repo-workflows/) to your project's `.github/workflows/` directory
2. **Update `package_name`** in each workflow to match your NPM package name
3. **Customize inputs** as needed for your project
4. **Commit and push** - workflows run automatically when triggered

## 🏗️ Architecture Overview

This repository uses a **streamlined orchestrator pattern** to eliminate hundreds of workflow files:

- **Single Orchestrator**: `ci-jobs.yml` contains all job logic with boolean flags
- **Simple Org Workflows**: `ci.yml`, `release.yml`, `publish.yml` call the orchestrator with specific flags
- **Modular Components**: Composite actions in `workflow-packages/` provide reusable functionality

## 📂 Repository Structure

```
.github/
├── workflows/              # Streamlined organization workflows
│   ├── ci-jobs.yml         # Main orchestrator with all job types
│   ├── ci.yml              # CI workflow (calls orchestrator)
│   ├── publish.yml         # Publishing workflow (calls orchestrator)
│   ├── release.yml         # Release workflow (calls orchestrator)
│   └── update-major-version-tags.yml # Version tagging (calls orchestrator)
├── actions/                # Composite actions (converted from jobs)
│   ├── npm/jobs/           # NPM-related composite actions
│   ├── git/jobs/           # Git operation composite actions
│   ├── github/jobs/        # GitHub API composite actions
│   └── ...
├── workflow-packages/      # Legacy modular components (being phased out)
└── examples/               # Usage examples and documentation
    └── individual-repo-workflows/
        ├── ci.yml          # Example CI workflow
        ├── publish.yml     # Example publishing workflow
        └── release.yml     # Example release workflow
```

## 🔧 Available Workflows

### CI Workflow (`ci.yml`)

- **Purpose**: Streamlined CI testing and building for NPM packages
- **Triggers**: Push to any branch, PR to master/main
- **Features**: Calls the orchestrator with `run_build_and_test: true`
- **Usage**: `CLDMV/.github/.github/workflows/ci.yml@v1`

### Release Workflow (`release.yml`)

- **Purpose**: Creates release PRs from release commits with changelog generation
- **Triggers**: Push to non-master/main branches (when you push `release:` or `release!:` commits)
- **Features**: Calls orchestrator with `run_detect_release` and `run_create_release_pr` flags
- **Usage**: `CLDMV/.github/.github/workflows/release.yml@v1`

### Publish Workflow (`publish.yml`)

- **Purpose**: Publishes packages to NPM and creates GitHub releases
- **Triggers**: PR closed on master branch (when release PRs are merged)
- **Features**: Full publishing pipeline using orchestrator with multiple flags
- **Usage**: `CLDMV/.github/.github/workflows/publish.yml@v1`

### Update Major Version Tags Workflow (`update-major-version-tags.yml`)

- **Purpose**: Automatically maintains major version tags (e.g., `v1`, `v2`) for semantic versioning
- **Triggers**: New release published or semantic version tag pushed
- **Features**: Calls orchestrator with `run_update_major_version_tags: true`
- **Usage**: `CLDMV/.github/.github/workflows/update-major-version-tags.yml@v1`

## 🏗️ Orchestrator Architecture

The new streamlined architecture uses a single `ci-jobs.yml` orchestrator that contains all job logic:

- **`ci-jobs.yml`**: Main orchestrator with boolean flags to enable specific job types

  - `run_build_and_test`: Build and test NPM packages
  - `run_detect_release`: Detect release commits
  - `run_create_release_pr`: Create release pull requests
  - `run_create_release`: Create GitHub releases
  - `run_publish_npm`: Publish to NPM registry
  - `run_publish_github_packages`: Publish to GitHub Packages
  - `run_update_major_version_tags`: Update version tags
  - `run_detect_repo_config`: Detect repository configuration

- **Composite Actions**: All jobs converted to composite actions in `.github/actions/`
  - `npm/jobs/`: Build, test, and publishing actions
  - `git/jobs/`: Release detection and version management
  - `github/jobs/`: GitHub API operations and repository management
- **`publish-package.yml`**: Universal package publishing action

This modular approach provides:

- ✅ **Consistency** across all organization projects
- ✅ **Maintainability** through centralized component management
- ✅ **Reusability** of workflow components
- ✅ **Flexibility** for project-specific customization

## 📖 Documentation

- **[Examples](examples/)**: Complete usage examples and documentation
- **[Workflow Packages](.github/workflow-packages/)**: Individual component documentation

## 🤝 Contributing

When contributing to the workflows:

1. Follow the modular architecture patterns with flattened `.yml` files
2. Update appropriate technology layer (common/git/github/npm)
3. Test changes with example workflows
4. Update documentation as needed
5. Use semantic versioning tags instead of `@master` references

## 🆘 Support

For issues or questions about the workflows:

- Check the [examples](examples/) for usage patterns
- Review component documentation in [.github/workflow-packages/](.github/workflow-packages/)
- Open an issue in this repository
