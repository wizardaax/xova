/**
 * TypeScript port of wizardaax/glyph_phase_engine.
 *
 * Source: https://github.com/wizardaax/glyph_phase_engine/blob/main/src/glyph_phase_engine/engine.py
 *
 * Same state machine, same thresholds. Used here to track Xova's runtime
 * coherence as a function of her self-evaluation scores: low hallucination
 * risk → small delta → STABILIZED. High risk → large delta → ERROR.
 *
 * Integration with Round 98 self-eval:
 *   delta = (hallucination_risk - 1) / 4   ∈ [0, 1]
 *   risk=1 → delta=0   (very small) → STABILIZED
 *   risk=2 → delta=0.25
 *   risk=3 → delta=0.5  (medium) → keep DELTA_ADJUSTMENT
 *   risk=4 → delta=0.75
 *   risk=5 → delta=1.0  (boundary) → ERROR threshold
 *
 * The substrate library running on the surface — not just visualised, used.
 */

// String-literal union instead of TS enum (erasableSyntaxOnly compatible).
export const PhaseState = {
  INITIAL: "initial",
  PROCESSING: "processing",
  DELTA_ADJUSTMENT: "delta_adjustment",
  STABILIZED: "stabilized",
  ERROR: "error",
} as const;
export type PhaseState = typeof PhaseState[keyof typeof PhaseState];

const SMALL_DELTA_THRESHOLD = 0.1;
const LARGE_DELTA_THRESHOLD = 1.0;
const INPUT_LENGTH_THRESHOLD = 100;

export class GlyphPhaseEngine {
  currentPhase: PhaseState;
  deltaValues: number[];
  symbolicInput: string | null;
  metadata: Record<string, unknown>;

  constructor(initialPhase: PhaseState = PhaseState.INITIAL) {
    this.currentPhase = initialPhase;
    this.deltaValues = [];
    this.symbolicInput = null;
    this.metadata = {};
  }

  processSymbolicInput(input: string): PhaseState {
    this.symbolicInput = input;
    this.currentPhase = PhaseState.PROCESSING;
    if (!input || typeof input !== "string") {
      this.currentPhase = PhaseState.ERROR;
      return this.currentPhase;
    }
    this.currentPhase = input.length > INPUT_LENGTH_THRESHOLD
      ? PhaseState.DELTA_ADJUSTMENT
      : PhaseState.STABILIZED;
    return this.currentPhase;
  }

  adjustPhaseDelta(delta: number): PhaseState {
    this.deltaValues.push(delta);
    if (this.currentPhase === PhaseState.DELTA_ADJUSTMENT || this.currentPhase === PhaseState.PROCESSING) {
      const abs = Math.abs(delta);
      if (abs < SMALL_DELTA_THRESHOLD) {
        this.currentPhase = PhaseState.STABILIZED;
      } else if (abs >= LARGE_DELTA_THRESHOLD) {
        this.currentPhase = PhaseState.ERROR;
      } else {
        this.currentPhase = PhaseState.DELTA_ADJUSTMENT;
      }
    }
    return this.currentPhase;
  }

  /** Map a self-eval hallucination risk (1..5) to a phase delta (0..1). */
  static riskToDelta(risk: number): number {
    return (Math.max(1, Math.min(5, risk)) - 1) / 4;
  }

  reset(): void {
    this.currentPhase = PhaseState.INITIAL;
    this.deltaValues = [];
    this.symbolicInput = null;
    this.metadata = {};
  }

  /** Recent volatility — average abs delta over the last N samples. */
  recentVolatility(n: number = 8): number {
    const recent = this.deltaValues.slice(-n);
    if (recent.length === 0) return 0;
    return recent.reduce((s, d) => s + Math.abs(d), 0) / recent.length;
  }
}

/** Singleton — the system-wide Xova phase engine, fed by self-eval. */
export const xovaPhase = new GlyphPhaseEngine();
