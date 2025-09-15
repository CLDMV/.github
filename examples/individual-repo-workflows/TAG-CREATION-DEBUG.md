# 🧪 Tag Creation Debugging Workflows

This directory contains comprehensive testing workflows to debug GitHub App permissions issues with tag creation.

## 📋 Overview

The test workflows help diagnose the GitHub App permission issue where tags cannot be pushed despite having the correct permissions. They test multiple approaches:

1. **GitHub API Tag Creation** - Creating tags via REST API
2. **Git Command Tag Creation** - Creating tags via git commands with App token
3. **Release Creation** - Creating releases tied to the tags
4. **Permission Variants** - Testing with and without explicit workflow permissions

## 🚀 Quick Start

### 1. Copy the Example Workflow

Copy `test-tag-creation-debug.yml` to your repository's `.github/workflows/` directory:

```bash
cp examples/individual-repo-workflows/test-tag-creation-debug.yml .github/workflows/
```

### 2. Update Package Name

Edit the workflow file and replace the package name:

```yaml
package_name: "@your-org/your-package"  # Replace with your actual package name
```

### 3. Run the Test

1. Go to your repository's Actions tab
2. Select "🧪 Test Tag Creation Debug" workflow  
3. Click "Run workflow"
4. Configure the test parameters:
   - **test_tag_name**: Unique tag name for testing (e.g., `test-debug-v1.0.0`)
   - **target_commit**: Leave empty to use HEAD, or specify a commit SHA
   - **cleanup_tag**: Whether to clean up test tags afterward (recommended: true)
   - **set_permissions**: Whether to also test with explicit permissions (recommended: true)

## 📊 What the Tests Show

### Test Results Matrix

| Test Scenario | Expected Behavior | What to Look For |
|---------------|-------------------|------------------|
| **API Tag Creation** | ✅ Should succeed | HTTP 201 response |
| **Git Tag Creation (No Perms)** | ❌ Should fail | Permission denied error |
| **Git Tag Creation (With Perms)** | 🤔 Test behavior | May still fail due to GitHub bug |
| **Release Creation** | ✅ Should succeed | HTTP 201 response |

### 🔍 Debugging Information

The workflow provides detailed debugging output:

- **Token Analysis**: Type detection (App token vs PAT vs default)
- **HTTP Response Codes**: Full API responses with error details
- **Git Command Output**: Detailed git operation logs
- **Repository State**: Before/after comparison of tags and releases
- **Permission Context**: Whether explicit permissions affect behavior

## 🐛 Known Issues & Expected Results

Based on the current GitHub App permission bug:

### Expected Failures

- ❌ **Git push operations** will fail with `workflows` permission error
- ❌ This happens even when the App has correct permissions
- ❌ Error message: "refusing to allow a GitHub App to create or update workflow..."

### Expected Successes  

- ✅ **API tag creation** should work
- ✅ **Release creation** should work
- ✅ **Local git tag creation** should work

## 📋 Analysis Checklist

When reviewing test results, check:

- [ ] **Token Type**: Confirms using GitHub App token (starts with `ghs_`)
- [ ] **API Operations**: Tag and release creation via API succeed
- [ ] **Git Push Failure**: Fails with workflow permission error
- [ ] **Permission Context**: Whether explicit permissions make any difference
- [ ] **Error Messages**: Exact error text from GitHub

## 🔧 Troubleshooting

### If API Operations Fail

1. **Check App Installation**: Ensure the GitHub App is installed on the repository
2. **Verify Permissions**: Confirm App has `contents:write` and `workflows:write`
3. **Token Generation**: Ensure `create-app-token` action is working correctly

### If All Operations Succeed

This would indicate the GitHub App permission issue has been resolved!

### If Results Are Inconsistent

- Run tests multiple times to check for intermittent issues
- Test on different repositories within your organization
- Compare results between repositories with/without workflow files

## 🎯 Next Steps

After running the tests:

1. **Document Results**: Save the workflow run logs and step summaries
2. **Compare Environments**: Test in different repositories if possible  
3. **Report to GitHub**: If confirmed as a bug, report to GitHub Support with test results
4. **Monitor Changes**: Re-run tests periodically to detect when GitHub fixes the issue

## 📞 Support

If you need help interpreting test results or have questions about the debugging process:

1. Review the workflow run logs and step summaries
2. Check the GitHub App permissions in your organization settings
3. Compare with working examples from other repositories

The test workflows are designed to provide comprehensive debugging information to help identify the root cause of tag creation permission issues.
