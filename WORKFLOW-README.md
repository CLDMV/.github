# CLDMV GitHub Organization Workflows 🚀

This repository contains reusable GitHub Actions workflows and modular components for the CLDMV organization.

## 📋 Quick Start

1. **Copy example workflows** from [`examples/individual-repo-workflows/`](examples/individual-repo-workflows/) to your project's `.github/workflows/` directory
2. **Update `package_name`** in each workflow to match your NPM package name
3. **Customize inputs** as needed for your project
4. **Commit and push** - workflows run automatically when triggered

## 📂 Repository Structure

```
.github/
├── workflows/              # Organization-level reusable workflows
│   ├── ci.yml              # Comprehensive CI testing
│   ├── publish.yml         # NPM package publishing
│   └── release.yml         # Release PR creation
├── workflow-packages/      # Modular workflow components
│   ├── common/steps/       # Shared step components (.yml files)
│   ├── git/                # Git operations (jobs, steps, utilities)
│   ├── github/             # GitHub API operations (api, jobs, steps, utilities)
│   ├── npm/                # NPM ecosystem operations (jobs, steps)
│   └── publish-package.yml # Universal package publishing action
└── examples/               # Usage examples and documentation
    ├── individual-repo-workflows/
    │   ├── ci.yml          # Example CI workflow
    │   ├── publish.yml     # Example publishing workflow
    │   └── release.yml     # Example release workflow
    └── README.md           # Usage instructions
```

## 🔧 Available Workflows

### CI Workflow (`ci.yml`)

- **Purpose**: Comprehensive testing and building for NPM packages
- **Triggers**: Push to any branch, PR to master/main
- **Features**: Multi-version Node.js testing, linting, performance tests, artifact uploads
- **Usage**: `CLDMV/.github/workflows/ci.yml@v1`

### Release Workflow (`release.yml`)

- **Purpose**: Creates release PRs from release commits with changelog generation
- **Triggers**: Push to non-master/main branches (when you push `release:` or `release!:` commits)
- **Features**: Version detection, changelog generation, signed commits, automated PRs
- **Usage**: `CLDMV/.github/workflows/release.yml@v1`

### Publish Workflow (`publish.yml`)

- **Purpose**: Publishes packages to NPM and creates GitHub releases
- **Triggers**: PR closed on master branch (when release PRs are merged)
- **Features**: Automated versioning, NPM publishing, GitHub releases, artifact management
- **Usage**: `CLDMV/.github/workflows/publish.yml@v1`

### Update Major Version Tags Workflow (`update-major-version-tags.yml`)

- **Purpose**: Automatically maintains major version tags (e.g., `v1`, `v2`) for semantic versioning
- **Triggers**: New release published or semantic version tag pushed
- **Features**: Auto-updates `v1` → `v1.x.x`, creates documentation, maintains version compatibility
- **Usage**: `CLDMV/.github/workflows/update-major-version-tags.yml@v1`

## 🏗️ Modular Architecture

The workflows are built using modular components organized by technology layer:

- **`common/steps/`**: Shared step components used across all workflows (checkout-code.yml, setup-node.yml, run-tests.yml, build-project.yml, upload-artifacts.yml)
- **`git/`**: Git operations with jobs, steps, and utilities (version extraction, changelog generation, release detection)
- **`github/`**: GitHub API operations with api, jobs, steps, and utilities (releases, commits, PR management, repo detection)
- **`npm/`**: NPM ecosystem operations with jobs and steps (dependency installation, publishing, version calculation)
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
