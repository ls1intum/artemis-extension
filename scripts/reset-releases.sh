#!/usr/bin/env bash

# Clean and Recreate All Releases Script
# Deletes all existing releases and tags, then recreates them from CHANGELOG

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
EXTENSION_DIR="iris-thaumantias"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG="${ROOT_DIR}/${EXTENSION_DIR}/CHANGELOG.md"

# Functions
print_step() {
    echo -e "${BLUE}==>${NC} ${GREEN}$1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Start
clear
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Clean & Recreate All Releases${NC}     ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

print_warning "This will DELETE all existing releases and tags!"
print_warning "Then recreate them from CHANGELOG.md"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    print_error "Aborted"
    exit 1
fi

echo ""

# Check GitHub CLI
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed"
    exit 1
fi

if ! gh auth status &> /dev/null; then
    print_error "Not authenticated with GitHub CLI"
    exit 1
fi

# Step 1: Delete all existing releases
print_step "Deleting all existing GitHub releases..."

EXISTING_RELEASES=$(gh release list --limit 100 | awk '{print $1}')

if [ -n "$EXISTING_RELEASES" ]; then
    echo "$EXISTING_RELEASES" | while read -r TAG; do
        print_info "Deleting release: ${TAG}"
        gh release delete "$TAG" --yes 2>/dev/null || true
    done
    print_success "All releases deleted"
else
    print_info "No releases found"
fi

echo ""

# Step 2: Delete all local and remote tags
print_step "Deleting all git tags..."

# Get all version tags (both with and without 'v' prefix)
ALL_TAGS=$(git tag -l)

if [ -n "$ALL_TAGS" ]; then
    echo "$ALL_TAGS" | while read -r TAG; do
        # Only delete version-like tags (v0.x.x or 0.x.x)
        if [[ "$TAG" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+.*$ ]]; then
            print_info "Deleting tag: ${TAG}"
            git tag -d "$TAG" 2>/dev/null || true
            git push origin ":refs/tags/$TAG" 2>/dev/null || true
        fi
    done
    print_success "All version tags deleted"
else
    print_info "No tags found"
fi

echo ""

# Step 3: Extract all versions from CHANGELOG
print_step "Extracting versions from CHANGELOG..."
VERSIONS=$(grep -o "^## \[[0-9.]*\]" "${CHANGELOG}" | sed 's/^## \[\(.*\)\]/\1/')

if [ -z "$VERSIONS" ]; then
    print_error "No versions found in CHANGELOG"
    exit 1
fi

VERSION_COUNT=$(echo "$VERSIONS" | wc -l | tr -d ' ')
print_success "Found ${VERSION_COUNT} versions"

echo ""

# Step 4: Create releases for each version
print_step "Creating releases..."

echo "$VERSIONS" | while read -r VERSION; do
    echo ""
    print_info "Processing version: ${VERSION}"
    
    TAG="${VERSION}"
    
    # Escape dots and brackets for sed
    ESCAPED_VERSION=$(echo "$VERSION" | sed 's/\./\\./g; s/\[/\\[/g; s/\]/\\]/g')
    
    # Extract changelog content for this version
    CHANGELOG_CONTENT=$(sed -n "/^## \[${ESCAPED_VERSION}\]/,/^## \[/p" "${CHANGELOG}" | sed '1d;$d')
    
    if [ -z "$CHANGELOG_CONTENT" ]; then
        print_error "Could not extract changelog for version ${VERSION}"
        continue
    fi
    
    # Create git tag
    print_info "Creating git tag ${TAG}..."
    git tag -a "$TAG" -m "Release ${VERSION}"
    git push origin "$TAG"
    
    # Create GitHub release with version number as title
    print_info "Creating GitHub release..."
    gh release create "$TAG" \
        --title "${VERSION}" \
        --notes "$CHANGELOG_CONTENT"
    
    print_success "Created release ${VERSION} (tag: ${TAG})"
    
    # Small delay to avoid rate limiting
    sleep 1
done

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}All Releases Recreated!${NC}           ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
print_info "Tags: 0.2.2, 0.2.1, etc."
print_info "Titles: 0.2.2, 0.2.1, etc."
echo ""
