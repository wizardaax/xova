/**
 * Minimal ternary-logic primitives ported from wizardaax/ziltrix-sch-core.
 *
 * Source: https://github.com/wizardaax/ziltrix-sch-core
 *
 * Balanced ternary: values are -1 ("F"), 0 ("U"), +1 ("T"). Provides
 * Kleene-style logical operators plus simple field-arithmetic ops used
 * across the Recursive Field Framework's symbolic layer.
 *
 * Tiny port — just enough to expose ternary primitives at runtime so
 * Xova can answer ternary questions deterministically.
 */

export type Tern = -1 | 0 | 1;

export function parseTern(s: string): Tern {
  const v = s.trim().toUpperCase();
  if (v === "T" || v === "+1" || v === "1" || v === "TRUE") return 1;
  if (v === "F" || v === "-1" || v === "FALSE") return -1;
  if (v === "U" || v === "0" || v === "UNKNOWN") return 0;
  throw new Error(`not a ternary value: ${s}`);
}

export function ternToStr(t: Tern): string {
  return t === 1 ? "T" : t === -1 ? "F" : "U";
}

/** Kleene NOT — flip sign. */
export const tNot = (a: Tern): Tern => -a as Tern;

/** Kleene AND — minimum. */
export const tAnd = (a: Tern, b: Tern): Tern => Math.min(a, b) as Tern;

/** Kleene OR — maximum. */
export const tOr = (a: Tern, b: Tern): Tern => Math.max(a, b) as Tern;

/** Kleene XOR (a ≠ b in non-U case; U if either is U). */
export const tXor = (a: Tern, b: Tern): Tern => {
  if (a === 0 || b === 0) return 0;
  return (a === b ? -1 : 1) as Tern;
};

/** Field add (modular over {-1, 0, +1} using the natural sum mod 3 with -1≡2). */
export const tAdd = (a: Tern, b: Tern): Tern => {
  const sum = (((a + b) % 3) + 3) % 3; // 0 1 2
  return (sum === 2 ? -1 : sum) as Tern;
};

/** Field multiply — real product, since the result lands in {-1, 0, +1}. */
export const tMul = (a: Tern, b: Tern): Tern => (a * b) as Tern;

/** Evaluate a tiny ternary expression like `T AND F`, `NOT U`, `+1 XOR -1`. */
export function evalTernExpression(expr: string): { result: Tern; trace: string } {
  const tokens = expr.trim().toUpperCase().split(/\s+/);
  if (tokens.length === 0) throw new Error("empty expression");
  // Unary: NOT x
  if (tokens.length === 2 && tokens[0] === "NOT") {
    const a = parseTern(tokens[1]);
    const r = tNot(a);
    return { result: r, trace: `NOT ${ternToStr(a)} = ${ternToStr(r)}` };
  }
  // Binary: a OP b
  if (tokens.length === 3) {
    const a = parseTern(tokens[0]);
    const b = parseTern(tokens[2]);
    const op = tokens[1];
    let r: Tern;
    switch (op) {
      case "AND": r = tAnd(a, b); break;
      case "OR":  r = tOr(a, b);  break;
      case "XOR": r = tXor(a, b); break;
      case "ADD": case "+":  r = tAdd(a, b); break;
      case "MUL": case "*":  r = tMul(a, b); break;
      default: throw new Error(`unknown ternary operator: ${op}`);
    }
    return { result: r, trace: `${ternToStr(a)} ${op} ${ternToStr(b)} = ${ternToStr(r)}` };
  }
  throw new Error("expected: NOT X  |  X OP Y  (X,Y ∈ {T,U,F,+1,0,-1})");
}
