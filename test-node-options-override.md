# Test NODE Environment Variables Override Feature

This document describes how to test the new NODE_ENV and NODE_OPTIONS override capability.

## Problem Solved

Previously, when consumers set:

```yaml
test_command: "NODE_OPTIONS='--conditions=slothlet-dev' npm test"
# or
test_command: "NODE_ENV=production npm test"
```

The workflow would still use the default environment settings because the `run-tests` action would override any NODE_ENV or NODE_OPTIONS set in the test command.

## Solution

The `run-tests` action now detects if NODE_ENV or NODE_OPTIONS is already set in the test command and preserves the user's settings.

## Test Cases

### Case 1: Default behavior (no NODE environment variables in command)

```yaml
test_command: "npm test"
```

**Expected**: NODE_ENV=development, NODE_OPTIONS=--conditions=development

### Case 2: Custom NODE_OPTIONS in command

```yaml
test_command: "NODE_OPTIONS='--conditions=slothlet-dev' npm test"
```

**Expected**: NODE_OPTIONS will be `--conditions=slothlet-dev` (user's setting preserved)

### Case 3: Custom NODE_ENV in command

```yaml
test_command: "NODE_ENV=production npm test"
```

**Expected**: NODE_ENV will be `production` (user's setting preserved)

### Case 4: Both NODE_ENV and NODE_OPTIONS in command

```yaml
test_command: "NODE_ENV=test NODE_OPTIONS='--conditions=slothlet-dev' npm test"
```

**Expected**: Both variables preserved as user specified

### Case 5: Complex NODE_OPTIONS patterns

```yaml
test_command: "NODE_OPTIONS='--conditions=slothlet-dev --experimental-modules' npm test"
```

**Expected**: Full NODE_OPTIONS preserved as user specified

## Implementation Details

The `run-tests` action now uses this logic:

1. Check if the test command contains `NODE_ENV=` or `NODE_OPTIONS=`
2. If either is found: Run the command as-is (preserves user's environment variables)
3. If neither is found: Prepend `NODE_ENV="development" NODE_OPTIONS="--conditions=development"` to the command

This maintains backward compatibility while allowing consumers to override either or both NODE environment variables when needed.

## Usage Examples

**Default behavior (unchanged):**

```yaml
test_command: "npm test" # Uses NODE_ENV=development, NODE_OPTIONS=--conditions=development
```

**Custom NODE_OPTIONS (now works!):**

```yaml
test_command: "NODE_OPTIONS='--conditions=slothlet-dev' npm test"
```

**Custom NODE_ENV (now works!):**

```yaml
test_command: "NODE_ENV=production npm test"
```

**Custom both (now works!):**

```yaml
test_command: "NODE_ENV=test NODE_OPTIONS='--conditions=slothlet-dev' npm test"
```

The consuming repository can now successfully override NODE_ENV and/or NODE_OPTIONS by including them directly in their test command, while maintaining the default development settings for repos that don't need to customize these values.

## Alternative: Using test_environment Parameter

As an alternative to embedding NODE_ENV and NODE_OPTIONS in the test command, you can now use the `test_environment` parameter:

```yaml
test_environment: "production" # Sets NODE_ENV=production, NODE_OPTIONS=--conditions=production
```

This is cleaner when you want to change both variables to the same environment value. The test command approach is better when you need fine-grained control over individual environment variables.
