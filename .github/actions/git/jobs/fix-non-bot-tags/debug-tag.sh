#!/bin/bash

# Debug Tag Information Script
# This script tests various ways to extract tag information
# Run this locally to compare with GitHub Actions output

TAG="${1:-v1}"

echo "=== Debug Tag Information for: $TAG ==="
echo "Git Version: $(git --version)"
echo "Date: $(date)"
echo ""

echo "=== Basic Tag Info ==="
echo "Tag exists check:"
git tag -l "$TAG" || echo "Tag not found locally"
echo ""

echo "=== Object Type Detection ==="
echo "git cat-file -t $TAG:"
OBJECT_TYPE=$(git cat-file -t "$TAG" 2>&1)
echo "$OBJECT_TYPE"
echo ""

echo "=== Direct Tag Content ==="
echo "git cat-file -p $TAG:"
git cat-file -p "$TAG" 2>&1
echo ""

echo "=== Rev-parse Methods ==="
echo "git rev-parse $TAG:"
git rev-parse "$TAG" 2>&1 || echo "Failed rev-parse"
echo ""

echo "git rev-parse $TAG^{commit}:"
git rev-parse "$TAG^{commit}" 2>&1 || echo "Failed rev-parse commit"
echo ""

echo "git rev-parse $TAG^{tag} (this might fail):"
git rev-parse "$TAG^{tag}" 2>&1 || echo "Failed rev-parse tag object"
echo ""

echo "=== For-each-ref Tag Info ==="
echo "git for-each-ref refs/tags/$TAG:"
git for-each-ref "refs/tags/$TAG" --format='%(refname) %(objecttype) %(object) %(*objecttype) %(*object)' 2>&1
echo ""

echo "=== Our Detection Logic Test ==="
DETECTED_TYPE=$(git cat-file -t "$TAG" 2>/dev/null || echo "unknown")
echo "Detected object type: $DETECTED_TYPE"

if [ "$DETECTED_TYPE" = "tag" ]; then
    echo "✅ ANNOTATED tag detected"
    echo ""
    echo "Tagger line:"
    git cat-file -p "$TAG" | grep "^tagger " || echo "No tagger line found"
    echo ""
    echo "Message extraction:"
    TAG_CONTENT=$(git cat-file -p "$TAG")
    if echo "$TAG_CONTENT" | grep -q "^tagger "; then
        # Extract everything after the tagger line, skip empty lines, stop at PGP signature
        MESSAGE=$(echo "$TAG_CONTENT" | sed -n '/^tagger /,${//!p}' | sed '1d' | sed '/^-----BEGIN PGP SIGNATURE-----/,$d' | sed '/^$/d')
        echo "Extracted message: '$MESSAGE'"
    else
        echo "No tagger line found"
    fi
    
elif [ "$DETECTED_TYPE" = "commit" ]; then
    echo "⚠️ LIGHTWEIGHT tag detected"
    echo ""
    echo "Author line:"
    git cat-file -p "$TAG" | grep "^author " || echo "No author line found"
    echo ""
    echo "Commit message extraction:"
    COMMIT_CONTENT=$(git cat-file -p "$TAG")
    MESSAGE=$(echo "$COMMIT_CONTENT" | sed -n '/^$/,${//!p}' | tail -n +2)
    echo "Extracted commit message: '$MESSAGE'"
    
else
    echo "❌ Unknown object type: $DETECTED_TYPE"
fi

echo ""
echo "=== Remote Comparison ==="
echo "Remote tags:"
git ls-remote --tags origin | grep "$TAG" || echo "Tag not found on remote"
