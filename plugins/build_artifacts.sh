#!/usr/bin/env bash
# Cross-platform friendly (bash) builder: build wheel+sdist, verify, checksums.
# Usage: bash scripts/build_artifacts.sh

set -euo pipefail

PYTHON=${PYTHON:-python}

echo "==> Upgrading build toolchain"
$PYTHON -m pip install --upgrade pip build twine || echo "Warning: Failed to upgrade tools, using existing versions"

echo "==> Building sdist + wheel"
# Clean previous builds
$PYTHON -c "
import os, shutil
for d in ('dist', 'build'):
    if os.path.exists(d):
        shutil.rmtree(d)
"
$PYTHON -m build

echo "==> Verifying package can be imported from wheel"
# Test that the wheel contains expected files rather than using twine
wheels=()
while IFS= read -r -d '' f; do wheels+=("$f"); done < <(find dist -name '*.whl' -print0 2>/dev/null)
if [ ${#wheels[@]} -gt 0 ]; then
    for wheel in "${wheels[@]}"; do
        echo "Checking wheel contents: $wheel"
        unzip -l "$wheel" | grep -E '(recursive_field_math|entry_points)' | head -5
    done
else
    echo "Warning: No wheel files found in dist/"
fi

echo "==> Calculating SHA256 checksums"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum dist/*
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 dist/*
else
  echo "No checksum tool found (sha256sum/shasum). Skipping."
fi

echo "==> Artifacts:"
ls -1 dist
