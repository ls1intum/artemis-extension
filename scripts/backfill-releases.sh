#!/usr/bin/env bash

# Backfill GitHub Releases Script
# Creates releases for all versions in CHANGELOG.md (without .vsix files)

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

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Start
clear
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Backfill GitHub Releases${NC}          ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
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

# Extract all version numbers from CHANGELOG
print_step "Extracting versions from CHANGELOG..."
VERSIONS=$(grep -o "^## \[[0-9.]*\]" "${CHANGELOG}" | sed 's/^## \[\(.*\)\]/\1/')

if [ -z "$VERSIONS" ]; then
    print_error "No versions found in CHANGELOG"
    exit 1
fi

echo "$VERSIONS" | while read -r VERSION; do
    echo ""
    print_info "Processing version: ${VERSION}"
    
    TAG="${VERSION}"
    
    # Check if release already exists
    if gh release view "$TAG" &> /dev/null; then
        print_info "Release ${TAG} already exists, skipping"
        continue
    fi
    
    # Escape dots and brackets for sed
    ESCAPED_VERSION=$(echo "$VERSION" | sed 's/\./\\./g; s/\[/\\[/g; s/\]/\\]/g')
    
    # Extract changelog content for this version
    CHANGELOG_CONTENT=$(sed -n "/^## \[${ESCAPED_VERSION}\]/,/^## \[/p" "${CHANGELOG}" | sed '1d;$d')
    
    if [ -z "$CHANGELOG_CONTENT" ]; then
        print_error "Could not extract changelog for version ${VERSION}"
        continue
    fi
    
    # Create git tag if it doesn't exist
    if ! git rev-parse "$TAG" >/dev/null 2>&1; then
        print_info "Creating git tag ${TAG}..."
        git tag -a "$TAG" -m "Release ${VERSION}"
        git push origin "$TAG"
    fi
    
    # Create GitHub release
    print_info "Creating GitHub release ${TAG}..."
    gh release create "$TAG" \
        --title "${VERSION}" \
        --notes "$CHANGELOG_CONTENT"
    
    print_success "Created release ${TAG}"
    
    # Small delay to avoid rate limiting
    sleep 1
done

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}All Releases Created!${NC}             ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
