#!/usr/bin/env bash
set -euo pipefail

# demo_loom.sh — One-click generation of demo artifacts for a 60s Loom recording.
#
# Usage:
#   bash scripts/demo_loom.sh
#
# This script:
# 1. Installs the package in editable mode
# 2. Runs the entropy pump harness to generate demo artifacts
# 3. Evaluates the latest summary with markdown output
# 4. Runs a mini CLI showcase (lucas/ratio/egypt) to populate out/
# 5. Displays clear instructions for the 60s recording sequence

echo "==> Demo Loom Setup — Generating artifacts for 60s recording"

# 1. Install package in editable mode
echo "==> Installing regen88-codex in editable mode"
pip install -e . -q

# 2. Create output directory
echo "==> Creating out/ directory for demo artifacts"
mkdir -p out

# 3. Run entropy pump harness (generates CSV, plots, summary JSON)
echo "==> Running entropy pump harness"
python -m scripts.run_entropy_pump_harness || {
    echo "⚠️  Entropy pump harness failed (may need valid PGN data)"
}

# 4. Evaluate latest summary if it exists
if [ -f "out/summary.json" ]; then
    echo "==> Evaluating summary with markdown output"
    rfm eval out/summary.json --markdown > out/eval_summary.md || {
        echo "⚠️  Eval command not available or failed"
    }
else
    echo "⚠️  No summary.json found; skipping eval"
fi

# 5. Mini CLI showcase
echo "==> Running CLI showcase commands"

echo "  → rfm lucas 0 10"
rfm lucas 0 10 > out/demo_lucas.txt || echo "⚠️  lucas command failed"

echo "  → rfm ratio 4 7"
rfm ratio 4 7 > out/demo_ratio.txt || echo "⚠️  ratio command failed"

echo "  → rfm egypt"
rfm egypt > out/demo_egypt.txt || echo "⚠️  egypt command failed"

echo ""
echo "✅ Demo artifacts generated in out/"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  60-SECOND LOOM RECORDING SEQUENCE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. [0:00-0:10] Introduction"
echo "   'Welcome to Xova Intelligence — ternary field agents powered by"
echo "    Lucas 4–7–11 resonance and φ-refraction.'"
echo ""
echo "2. [0:10-0:25] Quick Install & Verify"
echo "   • Show: pip install regen88-codex"
echo "   • Run:  rfm --help"
echo "   • Demo: rfm lucas 0 10"
echo ""
echo "3. [0:25-0:40] Entropy Pump Showcase"
echo "   • Open: out/summary.json"
echo "   • Show: Variance reduction metrics (before/after refraction)"
echo "   • Highlight: φ-based window selection"
echo ""
echo "4. [0:40-0:55] CLI Commands"
echo "   • Run: rfm ratio 4 7    (Golden ratio check)"
echo "   • Run: rfm egypt         (Egyptian fractions)"
echo "   • Show: Generated plots in out/"
echo ""
echo "5. [0:55-1:00] Call to Action"
echo "   'Star the repo: wizardaax/recursive-field-math-pro'"
echo "   'Install: pip install regen88-codex'"
echo "   'Explore the marketing kit and reproducibility docs!'"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Demo artifacts ready in out/:"
ls -lh out/ 2>/dev/null || echo "(No artifacts found)"
echo ""
