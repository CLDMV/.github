# CLDMV Workflow Packages 📦

This repository contains modular, reusable GitHub Actions workflows and components for the CLDMV organization.

## 🏗️ Architecture

```
.github/workflow-packages/
├── common/                    # Universal components
│   └── steps/                # Reusable steps for all technologies
├── git/                      # Git operations and analysis
│   ├── jobs/                 # Complete git workflows
│   ├── steps/                # Individual git operations
│   └── utilities/            # Git helper functions
├── github/                   # GitHub platform operations
│   ├── jobs/                 # Complete GitHub workflows
│   ├── steps/                # Individual GitHub operations
│   ├── api/                  # GitHub API interactions
│   └── utilities/            # GitHub helper functions
├── npm/                      # NPM ecosystem operations
│   ├── jobs/                 # Complete NPM workflows
│   ├── steps/                # Individual NPM operations
│   └── api/                  # NPM registry interactions
└── publish-package/          # Universal package publishing action
```

## 🚀 Org-Level Workflows

### CI Workflow (`ci.yml`)

Comprehensive testing and building for NPM packages.

**Features:**

- Primary Node.js version testing with full test suite
- Multi-version Node.js matrix testing
- Linting, building, entry point tests, performance tests
- Configurable test commands and Node.js versions
- Optional skipping of specific test types

### Release Workflow (`release.yml`)

Creates release PRs when release commits are detected.

**Features:**

- Detects `release:` and `release!:` commits
- Automatic version bump calculation (major/minor/patch)
- Comprehensive changelog generation
- Signed commit creation via GitHub API
- Automatic PR creation with release notes

### Publish Workflow (`publish.yml`)

Publishes packages when release PRs are merged.

**Features:**

- Release detection from PR titles and labels
- Build and test before publishing
- GitHub release creation with signed tags
- NPM and GitHub Packages publishing
- Repository configuration auto-detection
- Success notifications

## 📋 Usage in Individual Repositories

### 1. CI Workflow

```yaml
# .github/workflows/ci.yml
name: 🧪 CI Tests & Build

on:
  pull_request:
    branches: [master, main]
  push:
    branches: ["**"]
    paths-ignore:
      - "**.md"
      - "docs/**"

jobs:
  ci:
    uses: CLDMV/.github/.github/workflows/ci.yml@v2
    with:
      package_name: "@cldmv/your-package" # Required
      node_version: "lts/*"
      test_command: "npm test"
      build_command: "npm run build:ci"
      test_matrix_versions: '["18", "20", "21"]'
```

### 2. Release Workflow

```yaml
# .github/workflows/release.yml
name: 🚀 Release PR Creation

on:
  push:
    branches-ignore: [master, main]
    paths-ignore:
      - "**.md"
      - "docs/**"

jobs:
  create-release-pr:
    uses: CLDMV/.github/.github/workflows/release.yml@v2
    with:
      package_name: "@cldmv/your-package" # Required
      node_version: "lts/*"
      test_command: "npm test"
      build_command: "npm run build:ci"
    secrets: inherit
```

### 3. Publish Workflow

```yaml
# .github/workflows/publish.yml
name: 📦 Release and Publish

on:
  pull_request:
    types: [closed]
    branches: [master]

jobs:
  publish-package:
    uses: CLDMV/.github/.github/workflows/publish.yml@v2
    with:
      package_name: "@cldmv/your-package" # Required
      node_version: "lts/*"
      test_command: "npm test"
      build_command: "npm run build:ci"
    secrets: inherit
```

## 🔄 Workflow Sequence

1. **Development**: Push commits to feature branches → **CI Workflow** runs
2. **Release Preparation**: Push `release:` commit → **Release Workflow** creates release PR
3. **Release Publishing**: Merge release PR → **Publish Workflow** publishes package

## ⚙️ Configuration Options

### CI Workflow Options

- `skip_lint`: Skip linting step
- `skip_entry_tests`: Skip entry point tests
- `skip_performance_tests`: Skip performance tests
- `skip_matrix_tests`: Skip multi-version testing
- `test_matrix_versions`: JSON array of Node.js versions to test

### Release Workflow Options

- `package_manager`: npm or yarn
- `test_command`: Custom test command
- `build_command`: Custom build command

### Publish Workflow Options

- `publish_to_npm`: Enable/disable NPM publishing
- `publish_to_github_packages`: Enable/disable GitHub Packages publishing
- `dry_run`: Validate everything but don't publish or create releases (recommended for testing)
- `publish_command`: Custom NPM publish command
- `github_packages_publish_command`: Custom GitHub Packages command

## 🎯 Benefits

- **Consistency**: All repos use the same tested workflows
- **Maintenance**: Update workflows in one place
- **Flexibility**: Configurable for different project needs
- **Modularity**: Components can be reused across workflows
- **Reliability**: Centralized testing and validation

## 🔧 Development

To add new components:

1. Create in appropriate technology folder (`common/`, `git/`, `github/`, `npm/`)
2. Follow the established patterns for inputs/outputs
3. Update this README with usage examples
4. Test with a sample repository before organization-wide deployment
