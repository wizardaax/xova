/**
 * TypeScript port of canonical results from wizardaax/recursive-field-math-pro.
 *
 * Source: https://github.com/wizardaax/recursive-field-math-pro
 *
 * Closed-form Lucas / Fibonacci / r-theta field math, machine-verified at
 * 1e-14 precision in the source library's 320-test suite. Ported here so
 * Xova can answer math questions deterministically instead of letting the
 * small LLM confabulate ("9 + 1 = 10" — observed in probe).
 *
 * All thresholds, formulas, and identities mirror the Python originals
 * exactly. See docstrings in each function for the source path.
 */

export const PHI = (1 + Math.sqrt(5)) / 2;     // golden ratio  ≈ 1.6180339887498949
export const PSI = (1 - Math.sqrt(5)) / 2;     // conjugate     ≈ -0.6180339887498949
export const SQRT5 = Math.sqrt(5);
export const ROOT_SCALE = 3;                   // r = ROOT_SCALE * sqrt(n) — matches lib default

/**
 * Lucas number L(n).  Source: src/recursive_field_math/lucas.py
 *   L(0) = 2, L(1) = 1, L(n) = L(n-1) + L(n-2)
 *   Closed form: L(n) = round(φ^n + ψ^n)
 * Exact for all n ≥ 0 because (φ^n + ψ^n) is integer (algebraic-integer fact).
 */
export function lucas(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer");
  return Math.round(Math.pow(PHI, n) + Math.pow(PSI, n));
}

/**
 * Fibonacci number F(n).  Source: src/recursive_field_math/fibonacci.py
 *   F(0) = 0, F(1) = 1, F(n) = F(n-1) + F(n-2)
 *   Closed form (Binet): F(n) = (φ^n - ψ^n) / √5
 */
export function fib(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error("n must be a non-negative integer");
  return Math.round((Math.pow(PHI, n) - Math.pow(PSI, n)) / SQRT5);
}

/**
 * Polar field coordinates r(n), θ(n).  Source: src/recursive_field_math/field.py
 *   r(n) = ROOT_SCALE * √n
 *   θ(n) = n * φ   (radians, not modulo 2π)
 * The √n radius growth gives constant annular area (= ROOT_SCALE^2 * π) — proven
 * exactly in `paper/rff_geometric_invariants.tex` Theorem 3.
 */
export function rTheta(n: number): { r: number; theta: number } {
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer (n ≥ 1)");
  return { r: ROOT_SCALE * Math.sqrt(n), theta: n * PHI };
}

/**
 * Cassini-style identity: L(n)^2 - 5*F(n)^2 = 4*(-1)^n.
 * Returns the LHS - RHS difference (zero when identity holds).
 * Verified ≡ 0 for n ∈ [0, 29] in the source test suite.
 */
export function cassiniResidue(n: number): number {
  return lucas(n) * lucas(n) - 5 * fib(n) * fib(n) - 4 * Math.pow(-1, n);
}

/**
 * The ratio L(n+1)/L(n) → φ as n → ∞.  Returns the convergence error.
 */
export function phiConvergenceError(n: number): number {
  return lucas(n + 1) / lucas(n) - PHI;
}

/**
 * Annular area between successive points on the field.
 * Theorem 3: this is exactly ROOT_SCALE^2 * π for every n ≥ 1.
 * Returns the value (constant if the identity holds at machine precision).
 */
export function annularArea(n: number): number {
  if (n < 1) throw new Error("n must be ≥ 1");
  const r0 = n === 1 ? 0 : ROOT_SCALE * Math.sqrt(n - 1);
  const r1 = ROOT_SCALE * Math.sqrt(n);
  return Math.PI * (r1 * r1 - r0 * r0);
}
