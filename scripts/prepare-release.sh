#!/usr/bin/env bash

# Prepare Release Script for Artemis VS Code Extension
# This script updates version, changelog, and builds the extension without creating GitHub release

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

# Start release preparation
clear
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Release Preparation Script${NC}         ${BLUE}║${NC}"
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

# Get new version from command line or prompt
NEW_VERSION="$1"

if [ -z "$NEW_VERSION" ]; then
    print_error "Please provide a version number"
    echo "Usage: $0 <version>"
    echo "Example: $0 0.2.3"
    exit 1
fi

print_info "Target version: ${NEW_VERSION}"

# Update version in package.json
print_step "Updating version in package.json..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" "${PACKAGE_JSON}"
else
    # Linux
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${NEW_VERSION}\"/" "${PACKAGE_JSON}"
fi
print_success "Version updated to ${NEW_VERSION}"

# Ensure engines.vscode is set for backwards compatibility
print_step "Setting engines.vscode for backwards compatibility..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' 's/"vscode": "[^"]*"/"vscode": "^1.97.0"/' "${PACKAGE_JSON}"
else
    # Linux
    sed -i 's/"vscode": "[^"]*"/"vscode": "^1.97.0"/' "${PACKAGE_JSON}"
fi
print_success "engines.vscode set to ^1.97.0"

# Update CHANGELOG
print_step "Updating CHANGELOG.md..."

# Get current date
RELEASE_DATE=$(date +%Y-%m-%d)

# Replace [Unreleased] with the new version and date
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/## \[Unreleased\]/## [Unreleased]\n\n## [${NEW_VERSION}] - ${RELEASE_DATE}/" "${CHANGELOG}"
else
    # Linux
    sed -i "s/## \[Unreleased\]/## [Unreleased]\n\n## [${NEW_VERSION}] - ${RELEASE_DATE}/" "${CHANGELOG}"
fi

print_success "CHANGELOG.md updated with version ${NEW_VERSION}"

# Build the extension
print_step "Building extension..."
cd "${ROOT_DIR}/${EXTENSION_DIR}"

# Run the package script
npm run package

# Temporarily downgrade @types/vscode for VSIX packaging to match engines.vscode
print_step "Temporarily adjusting @types/vscode for packaging..."
ORIGINAL_TYPES_VERSION=$(grep -o '"@types/vscode": "[^"]*"' package.json | cut -d'"' -f4)
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' 's/"@types\/vscode": "[^"]*"/"@types\/vscode": "1.97.0"/' package.json
else
    sed -i 's/"@types\/vscode": "[^"]*"/"@types\/vscode": "1.97.0"/' package.json
fi

# Install the downgraded version temporarily
npm install --silent

# Create VSIX file
print_step "Creating VSIX package..."
npx @vscode/vsce package

# Restore original @types/vscode version
print_step "Restoring @types/vscode to ${ORIGINAL_TYPES_VERSION}..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/\"@types\/vscode\": \"[^\"]*\"/\"@types\/vscode\": \"${ORIGINAL_TYPES_VERSION}\"/" package.json
else
    sed -i "s/\"@types\/vscode\": \"[^\"]*\"/\"@types\/vscode\": \"${ORIGINAL_TYPES_VERSION}\"/" package.json
fi

# Reinstall with original version
npm install --silent

VSIX_FILE="${ROOT_DIR}/${EXTENSION_DIR}/${EXTENSION_DIR}-${NEW_VERSION}.vsix"

if [ -f "$VSIX_FILE" ]; then
    print_success "VSIX file created: $(basename "$VSIX_FILE")"
else
    print_error "Failed to create VSIX file"
    exit 1
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Release Prepared Successfully!${NC}     ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""
print_info "Version: ${NEW_VERSION}"
print_info "VSIX: ${VSIX_FILE}"
echo ""
print_info "Next steps:"
echo "  • Review changes: git diff"
echo "  • Commit changes: git add . && git commit -m 'Release ${NEW_VERSION}'"
echo "  • Create GitHub release: ./scripts/create-release.sh"
echo ""
