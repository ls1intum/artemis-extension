#!/usr/bin/env bash

# Build Extension Script for Artemis VS Code Extension
# This script builds and packages the extension for distribution

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
BUILD_DIR="${ROOT_DIR}/${EXTENSION_DIR}"

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

# Start build process
clear
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Artemis Extension Build Script${NC}     ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in the right directory
if [ ! -d "${BUILD_DIR}" ]; then
    print_error "Extension directory not found: ${BUILD_DIR}"
    exit 1
fi

cd "${BUILD_DIR}"
print_info "Working directory: ${BUILD_DIR}"
echo ""

# Step 1: Clean previous builds
print_step "Cleaning previous builds..."
if [ -d "dist" ]; then
    rm -rf dist
    print_success "Removed dist directory"
fi
if ls *.vsix 1> /dev/null 2>&1; then
    rm -f *.vsix
    print_success "Removed old .vsix files"
fi
echo ""

# Step 2: Check Node.js and npm
print_step "Checking prerequisites..."
NODE_VERSION=$(node --version 2>/dev/null || echo "not found")
NPM_VERSION=$(npm --version 2>/dev/null || echo "not found")

if [ "$NODE_VERSION" = "not found" ]; then
    print_error "Node.js is not installed"
    exit 1
fi

if [ "$NPM_VERSION" = "not found" ]; then
    print_error "npm is not installed"
    exit 1
fi

print_success "Node.js: ${NODE_VERSION}"
print_success "npm: ${NPM_VERSION}"
echo ""

# Step 3: Install dependencies
print_step "Installing dependencies..."
if npm install; then
    print_success "Dependencies installed"
else
    print_error "Failed to install dependencies"
    exit 1
fi
echo ""

# Step 4: Type checking
print_step "Running type checks..."
if npm run check-types; then
    print_success "Type checking passed"
else
    print_error "Type checking failed"
    exit 1
fi
echo ""

# Step 5: Linting
print_step "Running linter..."
if npm run lint; then
    print_success "Linting passed"
else
    print_error "Linting failed"
    exit 1
fi
echo ""

# Step 6: Build the extension
print_step "Building extension..."
if npm run package; then
    print_success "Build completed successfully"
else
    print_error "Build failed"
    exit 1
fi
echo ""

# Step 7: Package as .vsix (if vsce is available)
print_step "Checking for vsce (VS Code packaging tool)..."
if command -v vsce &> /dev/null; then
    print_success "vsce found, packaging extension..."
    if vsce package; then
        VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)
        if [ -n "$VSIX_FILE" ]; then
            VSIX_SIZE=$(du -h "$VSIX_FILE" | cut -f1)
            print_success "Extension packaged: ${VSIX_FILE} (${VSIX_SIZE})"
        fi
    else
        print_warning "Packaging with vsce failed"
    fi
else
    print_warning "vsce not found. Install with: npm install -g @vscode/vsce"
    print_info "You can still test the extension in development mode"
fi
echo ""

# Step 8: Summary
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}Build Summary${NC}                      ${BLUE}║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

DIST_SIZE=$(du -sh dist 2>/dev/null | cut -f1 || echo "N/A")
EXTENSION_JS_SIZE=$(du -h dist/extension.js 2>/dev/null | cut -f1 || echo "N/A")

print_info "Output directory: dist/"
print_info "Bundle size: ${EXTENSION_JS_SIZE}"
print_info "Total dist size: ${DIST_SIZE}"

if ls *.vsix 1> /dev/null 2>&1; then
    VSIX_FILE=$(ls -t *.vsix | head -1)
    VSIX_SIZE=$(du -h "$VSIX_FILE" | cut -f1)
    print_info "VSIX package: ${VSIX_FILE} (${VSIX_SIZE})"
fi

echo ""
echo -e "${GREEN}✓ Build completed successfully!${NC}"
echo ""

# Next steps
echo -e "${YELLOW}Next steps:${NC}"
echo "  • Test in VS Code: Press F5 in VS Code to launch Extension Development Host"
echo "  • Install locally: code --install-extension $(ls -t *.vsix 2>/dev/null | head -1 || echo 'package.vsix')"
echo "  • Publish: vsce publish"
echo ""
