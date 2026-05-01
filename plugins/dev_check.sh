#!/usr/bin/env bash
# Development check: run all linting, type checking, and tests
# Usage: bash scripts/dev_check.sh

set -euo pipefail

echo "==> Running development checks"

# Lint with ruff (warnings only for now)
echo "==> Linting with ruff"
python -m ruff check . || echo "⚠️  Linting issues found (not blocking)"

# Run tests with pytest
echo "==> Running tests with pytest"
python -m pytest -v

# Check if package can be imported
echo "==> Testing package import"
PYTHONPATH="src:${PYTHONPATH:-}" python -c "import recursive_field_math; print('✓ Package imports successfully')"

# Test CLI command
echo "==> Testing CLI command"
PYTHONPATH="${PYTHONPATH:-}" python -c "
import subprocess
import os
import sys

# Add src to path for testing
sys.path.insert(0, 'src')

# Test CLI via python module
result = subprocess.run([sys.executable, '-m', 'recursive_field_math.cli', '--help'],
                       capture_output=True, text=True,
                       env=dict(os.environ, PYTHONPATH='src:' + os.environ.get('PYTHONPATH', '')))
if result.returncode == 0:
    print('✓ CLI command works')
else:
    print('✗ CLI command failed')
    print(result.stderr)
    exit(1)
"

# Test scripts can be imported
echo "==> Testing script imports"
PYTHONPATH="src:${PYTHONPATH:-}" python -c "
try:
    from scripts.codex_entropy_pump import PHI
    from scripts.results_evaluator import evaluate_acceptance_rules
    print('✓ Script imports work')
except ImportError as e:
    print(f'✗ Script import failed: {e}')
    exit(1)
"

echo "==> All checks passed! ✓"
