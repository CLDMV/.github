# Revoke GitHub App Token Action

This action revokes a GitHub App installation token using the GitHub API.

## Description

This action is typically used at the end of workflows to properly clean up GitHub App installation tokens and ensure they don't remain active after the workflow completes. It helps maintain security by explicitly revoking tokens when they're no longer needed.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `auth-token` | GitHub App installation token to revoke | Yes | - |

## Usage

```yaml
- name: Revoke App token
  uses: CLDMV/.github/.github/actions/github/api/revoke-app-token@v1
  with:
    auth-token: ${{ steps.create-token.outputs.token }}
```

## Example Workflow

```yaml
name: Example with Token Cleanup
on: [push]

jobs:
  example:
    runs-on: ubuntu-latest
    steps:
      - name: Create GitHub App Token
        id: create-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.APP_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
      
      # ... do work with the token ...
      
      - name: Revoke App token
        if: always() # Always run to ensure cleanup
        uses: CLDMV/.github/.github/actions/github/api/revoke-app-token@v1
        with:
          auth-token: ${{ steps.create-token.outputs.token }}
```

## Implementation Details

- Uses the GitHub API `DELETE /installation/token` endpoint
- Provides debug logging when `CI_DEBUG=true` or `INPUT_DEBUG=true`
- Handles errors gracefully - warns on failure but doesn't fail the workflow
- Follows CLDMV's standardized action patterns and logging

## Security Notes

- This action helps maintain security by explicitly revoking tokens
- Failed revocation is logged as a warning rather than an error to prevent workflow failures
- Token values are partially masked in debug logs for security
