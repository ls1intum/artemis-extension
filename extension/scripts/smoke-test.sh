#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Artemis Extension Smoke Test ==="
echo ""

# Step 1: Package the extension
echo "[1/4] Packaging extension..."
npm run package:vsix
VSIX=$(ls -t *.vsix 2>/dev/null | head -1)
if [ -z "$VSIX" ]; then
    echo "ERROR: No .vsix file found after packaging"
    exit 1
fi
echo "  Created: $VSIX"
echo "  Size: $(du -h "$VSIX" | cut -f1)"
echo ""

# Step 2: Bundle size report
echo "[2/4] Bundle size report (webview):"
npm run analyze:text 2>/dev/null || echo "  (run 'npm run package' first to generate metafile)"
echo ""

# Step 3: Install extension in IRIS profile
echo "[3/4] Installing extension in IRIS profile..."
code --profile IRIS --install-extension "$VSIX"
echo ""

# Step 4: Open a new window for testing
echo "[4/4] Opening new VS Code window with IRIS profile..."
code --profile IRIS --new-window .

echo ""
echo "=== Manual Verification Checklist ==="
echo "  [ ] 1. Login view renders correctly"
echo "  [ ] 2. Dashboard loads with course data"
echo "  [ ] 3. CourseList — search, filter, sort work"
echo "  [ ] 4. CourseDetail — exercises listed, navigation works"
echo "  [ ] 5. ExerciseDetail — problem statement renders (math, code blocks)"
echo "  [ ] 6. Iris Chat — loads, sends messages, receives responses"
echo "  [ ] 7. Service status — health checks execute"
echo "  [ ] 8. Error states — network off, wrong server URL"
echo "  [ ] 9. Dark theme + Light theme render correctly"
echo ""
echo "Type 'pass' if all checks pass, or describe failures."
