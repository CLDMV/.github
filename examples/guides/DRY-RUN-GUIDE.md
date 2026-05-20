# 🧪 Dry Run Guide for CLDMV Workflows

The CLDMV workflows include comprehensive dry run modes that let you validate entire processes without making any actual changes. This is perfect for testing before committing to version bumps or publishing.

## 🎯 Available Dry Run Workflows

### 🚀 Release Workflow Dry Run

- **Purpose**: Validate release PR creation without making changes
- **Validates**: Release detection, version calculation, build, changelog generation
- **Skips**: Package.json updates, commits, PR creation

### 📦 Publish Workflow Dry Run

- **Purpose**: Validate publishing pipeline without actual publishing
- **Validates**: NPM/GitHub Packages authentication, release creation setup
- **Skips**: Actual publishing, GitHub release creation, tag creation

## 🎯 When to Use Dry Run

- **Before first release**: Test that your workflow setup is correct
- **Complex releases**: Validate changelog generation and version calculations
- **Publishing setup**: Test NPM tokens and GitHub Packages configuration
- **Debugging**: Troubleshoot release detection or publishing issues
- **Safety first**: Ensure everything works before creating actual releases or publishing

## 🚀 How to Use Dry Run

### Option 1: Manual Workflow Trigger

#### For Release Workflow:

1. Go to your repository's **Actions** tab
2. Select the **"🚀 Create Release PR"** workflow
3. Click **"Run workflow"**
4. Set `dry_run` to `true`
5. Configure other parameters as needed
6. Click **"Run workflow"**

#### For Publish Workflow:

1. Go to your repository's **Actions** tab
2. Select the **"📦 Release and Publish"** workflow
3. Click **"Run workflow"**
4. Set `dry_run` to `true`
5. Configure other parameters as needed
6. Click **"Run workflow"**

### Option 2: Workflow Dispatch in Code

```yaml
# .github/workflows/release.yml
on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Dry run mode - validate everything but don't create PR or make changes"
        type: boolean
        default: false
```

## ✅ What Dry Run Validates

### 🔍 Release Detection

- Confirms your commit message triggers release detection
- Validates commit categorization (`release:`, `release!:`)
- Tests version bump calculation logic

### 📦 Build Process

- Runs full build and test suite
- Validates all dependencies install correctly
- Ensures build commands execute successfully

### 📋 Changelog Generation

- Creates complete changelog with proper formatting
- Tests GitHub API integration for user lookups
- Validates commit categorization and formatting

### 🔢 Version Management

- Calculates new version based on commit messages
- Validates semver compliance
- Tests version bump logic (major/minor/patch)

## ❌ What Dry Run Skips

### 🚫 No File Changes

- Package.json version updates are skipped
- No actual commits are created
- Repository files remain unchanged

### 🚫 No GitHub Actions

- Pull requests are not created
- No GitHub API write operations
- No repository state changes

## 📊 Reading Dry Run Results

### Successful Dry Run Output

```
🧪 Dry Run - Release Workflow Validation

Package: @cldmv/your-package

✅ Overall Status: Dry run validation successful

New Version: v1.2.3

🧪 Dry Run Complete: All validations passed! No changes were made.

✅ Validation Results:
- Release commit detected successfully
- Version calculation completed
- Build and tests passed
- Changelog generation successful
- All prerequisites met for release PR creation

🚀 Ready to Release: Re-run with dry_run: false to create the actual release PR.
```

### What to Look For

1. **Release Detection**: Confirm your commit message was detected as a release
2. **Version Calculation**: Verify the new version number is correct
3. **Build Success**: Ensure all tests and builds pass
4. **Changelog Preview**: Review the generated changelog content
5. **Prerequisites**: Check that all validation steps completed

## 🔄 From Dry Run to Real Release

Once your dry run passes successfully:

1. **Review the Results**: Confirm version, changelog, and build outputs
2. **Re-run with dry_run: false**: Use the same parameters but disable dry run
3. **Monitor the Real Run**: Watch for the actual PR creation
4. **Review and Merge**: Complete the release by reviewing and merging the created PR

## 🛠️ Troubleshooting Dry Runs

### Common Issues

**❌ "No release needed"**

- Your commit message doesn't start with `release:` or `release!:`
- Try: `release: add new feature` or `release!: breaking change`

**❌ Build failures**

- Dependencies may be missing or incompatible
- Check your `package.json` and lockfiles
- Ensure build commands are correct

**❌ Version calculation errors**

- Previous version tags may be malformed
- Verify your git tags follow semver (e.g., `v1.2.3`)

### Getting Help

1. **Enable Debug Mode**: Set `debug: true` along with `dry_run: true`
2. **Check Workflow Logs**: Review detailed output in the Actions tab
3. **Review Examples**: Check the `examples/` directory for reference workflows

## 💡 Pro Tips

- **Always dry run first** for important releases
- **Use debug mode** when troubleshooting workflow issues
- **Test with different commit message formats** to understand version bumping
- **Review changelog output** to ensure proper contributor attribution
- **Validate build commands** work in the CI environment

## 🎉 Example Workflow

1. **Prepare Release Commit**:

   ```bash
   git commit -m "release: add amazing new feature"
   git push origin feature-branch
   ```

2. **Run Dry Run**:

   - Go to Actions → Create Release PR → Run workflow
   - Set `dry_run: true`
   - Review all validation results

3. **Execute Real Release**:
   - Re-run with `dry_run: false`
   - Review created PR
   - Merge when ready

This approach ensures you never waste time with failed releases or unwanted version bumps!
