#!/bin/bash
#
# Run E2E Tests for iris-thaumantias Extension
#
# This script:
# 1. Checks if Artemis is running
# 2. Starts Iris (if not already running)
# 3. Runs the E2E tests
# 4. Shows results
#
# Usage:
#   ./run-e2e-tests.sh [EXERCISE_ID]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(dirname "$SCRIPT_DIR")"
IRIS_DIR="/Users/liamberger/Documents/private/edutelligence/iris"
EXERCISE_ID="${1:-1}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

cleanup() {
    if [ -n "$IRIS_PID" ] && kill -0 "$IRIS_PID" 2>/dev/null; then
        log_info "Stopping Iris (PID: $IRIS_PID)..."
        kill "$IRIS_PID" 2>/dev/null || true
        wait "$IRIS_PID" 2>/dev/null || true
    fi
}

trap cleanup EXIT

check_artemis() {
    log_info "Checking if Artemis is running..."
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:8080" | grep -q "200"; then
        log_success "Artemis is running!"
        return 0
    else
        log_error "Artemis is NOT running on localhost:8080"
        log_error "Please start Artemis first!"
        return 1
    fi
}

start_iris() {
    # Check if Iris is already running
    if lsof -ti:8000 > /dev/null 2>&1; then
        log_info "Iris is already running on port 8000"
        return 0
    fi

    log_info "Starting Iris..."
    
    cd "$IRIS_DIR"
    
    if ! docker info > /dev/null 2>&1; then
        log_error "Docker is not running."
        return 1
    fi
    
    log_info "Starting Weaviate..."
    docker compose -f docker/weaviate.yml up -d
    sleep 3
    
    log_info "Starting Iris server..."
    APPLICATION_YML_PATH=./application.local.yml \
    LLM_CONFIG_PATH=./llm_config.local.yml \
    poetry run uvicorn iris.main:app --reload --port 8000 --app-dir src &
    
    IRIS_PID=$!
    log_info "Iris started with PID: ${IRIS_PID}"
    
    # Wait for Iris to be ready
    log_info "Waiting for Iris to be ready..."
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if lsof -ti:8000 > /dev/null 2>&1; then
            sleep 2
            log_success "Iris is ready!"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
        echo -n "."
    done
    
    echo ""
    log_error "Iris did not start in time"
    return 1
}

run_tests() {
    log_info "Running E2E tests..."
    
    cd "$EXTENSION_DIR"
    
    # Set environment variables for the tests
    export ARTEMIS_URL="http://localhost:8080"
    export ARTEMIS_USER="artemis_admin"
    export ARTEMIS_PASSWORD="artemis_admin"
    export EXERCISE_ID="$EXERCISE_ID"
    
    # Run the E2E tests
    npm run test:e2e
}

main() {
    log_section "Extension E2E Tests"
    
    echo "Configuration:"
    echo "  Extension Dir: $EXTENSION_DIR"
    echo "  Exercise ID:   $EXERCISE_ID"
    echo ""
    
    log_section "Step 1: Check Artemis"
    check_artemis || exit 1
    
    log_section "Step 2: Start Iris"
    start_iris || exit 1
    
    log_section "Step 3: Run E2E Tests"
    run_tests
    
    log_section "Complete"
    log_success "E2E tests finished!"
}

main "$@"
