#!/usr/bin/env bash

# Create GitHub Release Script for Artemis VS Code Extension
# This script creates a GitHub release with the changelog for the current version

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
EXTENSION_DIR="iris-thaumantias"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_JSON="${ROOT_DIR}/${EXTENSION_DIR}/package.json"
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

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Start release process
clear
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}GitHub Release Creation Script${NC}     ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "${PACKAGE_JSON}" ]; then
    print_error "package.json not found at: ${PACKAGE_JSON}"
    exit 1
fi

if [ ! -f "${CHANGELOG}" ]; then
    print_error "CHANGELOG.md not found at: ${CHANGELOG}"
    exit 1
fi

# Get version from package.json
print_step "Reading version from package.json..."
VERSION=$(grep -o '"version": *"[^"]*"' "${PACKAGE_JSON}" | cut -d'"' -f4)

if [ -z "$VERSION" ]; then
    print_error "Could not extract version from package.json"
    exit 1
fi

print_success "Version: ${VERSION}"
TAG="v${VERSION}"

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
    print_warning "Tag ${TAG} already exists!"
    read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "$TAG"
        git push origin ":refs/tags/$TAG" 2>/dev/null || true
        print_success "Deleted existing tag"
    else
        print_error "Aborted"
        exit 1
    fi
fi

# Extract changelog for current version
print_step "Extracting changelog for version ${VERSION}..."

# Escape dots and brackets for sed
ESCAPED_VERSION=$(echo "$VERSION" | sed 's/\./\\./g; s/\[/\\[/g; s/\]/\\]/g')

# Use sed to extract content between version headers
CHANGELOG_CONTENT=$(sed -n "/^## \[${ESCAPED_VERSION}\]/,/^## \[/p" "${CHANGELOG}" | sed '1d;$d')

if [ -z "$CHANGELOG_CONTENT" ]; then
    print_error "Could not find changelog entry for version ${VERSION}"
    print_info "Make sure CHANGELOG.md has an entry for version ${VERSION}"
    print_info "Changelog path: ${CHANGELOG}"
    exit 1
fi

print_success "Changelog extracted"

# Check if GitHub CLI is installed
if ! command -v gh &> /dev/null; then
    print_error "GitHub CLI (gh) is not installed"
    print_info "Install it with: brew install gh"
    print_info "Or download from: https://cli.github.com/"
    exit 1
fi

# Check if authenticated with GitHub CLI
if ! gh auth status &> /dev/null; then
    print_error "Not authenticated with GitHub CLI"
    print_info "Run: gh auth login"
    exit 1
fi

# Ensure we're on the main branch and up to date
print_step "Checking git status..."
CURRENT_BRANCH=$(git branch --show-current)

if [ "$CURRENT_BRANCH" != "main" ]; then
    print_warning "You are not on the main branch (current: ${CURRENT_BRANCH})"
    read -p "Do you want to continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "Aborted"
        exit 1
    fi
fi

# Check for uncommitted changes
if ! git diff-index --quiet HEAD --; then
    print_warning "You have uncommitted changes"
    read -p "Do you want to continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "Aborted"
        exit 1
    fi
fi

# Create git tag
print_step "Creating git tag ${TAG}..."
git tag -a "$TAG" -m "Release ${VERSION}"
git push origin "$TAG"
print_success "Tag created and pushed"

# Find the .vsix file
VSIX_FILE="${ROOT_DIR}/${EXTENSION_DIR}/${EXTENSION_DIR}-${VERSION}.vsix"

if [ ! -f "$VSIX_FILE" ]; then
    print_warning ".vsix file not found at: ${VSIX_FILE}"
    print_info "Building extension..."
    "${ROOT_DIR}/scripts/build-extension.sh"
fi

if [ ! -f "$VSIX_FILE" ]; then
    print_error "Failed to find or build .vsix file"
    exit 1
fi

print_success "Found .vsix file: $(basename "$VSIX_FILE")"

# Create GitHub release
print_step "Creating GitHub release..."

# Prompt for optional release title
echo ""
print_info "Enter a release title (or press Enter to use just version number):"
read -p "Title: " RELEASE_SUFFIX

if [ -n "$RELEASE_SUFFIX" ]; then
    RELEASE_TITLE="${VERSION} - ${RELEASE_SUFFIX}"
else
    RELEASE_TITLE="${VERSION}"
fi

print_info "Release title: ${RELEASE_TITLE}"
echo ""

gh release create "$TAG" \
    --title "$RELEASE_TITLE" \
    --notes "$CHANGELOG_CONTENT" \
    "$VSIX_FILE"

if [ $? -eq 0 ]; then
    print_success "GitHub release created successfully!"
    echo ""
    print_info "Release URL: https://github.com/ls1intum/artemis-extension/releases/tag/${TAG}"
else
    print_error "Failed to create GitHub release"
    exit 1
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Release Created Successfully!${NC}      ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
print_info "Next steps:"
echo "  • Publish to VS Code Marketplace: cd ${EXTENSION_DIR} && npx vsce publish"
echo "  • Announce the release to users"
echo ""
