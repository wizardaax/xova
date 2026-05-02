/**
 * Canonical SCE-88 stack — names exactly mirror
 *   github.com/wizardaax/SCE-88/blob/main/validation/validator.py  LEVELS
 *   github.com/wizardaax/SCE-88/blob/main/spec/domains.md
 *
 * 22 ordered levels × 4 isolated domains. Each domain implements all 22
 * levels independently; cross-domain state sharing is forbidden, all
 * interaction is explicitly gated.
 *
 * Intelligence/continuity band: levels 17-22 (Semantic Interface, Adaptive
 * Optimization, Coherence Closure, Self-Observation, Intent Continuity,
 * External Compatibility).
 *
 * This module tags Xova runtime events against the canonical level they
 * touch, so /sce can show "X% of activity in the intelligence band".
 * Counters are session-scoped and in-memory.
 */

export const SCE88_LEVELS = [
  { index: 1,  name: "Substrate Constraints",       group: "I — Physical Closure",          band: "computational" },
  { index: 2,  name: "Signal Transduction",         group: "I — Physical Closure",          band: "computational" },
  { index: 3,  name: "Temporal Ordering",           group: "I — Physical Closure",          band: "computational" },
  { index: 4,  name: "System Identification",       group: "I — Physical Closure",          band: "computational" },
  { index: 5,  name: "Actuation Control",           group: "I — Physical Closure",          band: "computational" },
  { index: 6,  name: "Uncertainty Modelling",       group: "II — Stability and Correction", band: "computational" },
  { index: 7,  name: "Stabilization Mechanisms",    group: "II — Stability and Correction", band: "computational" },
  { index: 8,  name: "Fault Correction",            group: "II — Stability and Correction", band: "computational" },
  { index: 9,  name: "Resolution Engine",           group: "II — Stability and Correction", band: "computational" },
  { index: 10, name: "Constraint Compilation",      group: "III — Execution",               band: "computational" },
  { index: 11, name: "Execution Coordination",      group: "III — Execution",               band: "computational" },
  { index: 12, name: "Correctness Enforcement",     group: "III — Execution",               band: "computational" },
  { index: 13, name: "Integrity Assurance",         group: "IV — Trust, Structure, Env",   band: "computational" },
  { index: 14, name: "Structural Topology",         group: "IV — Trust, Structure, Env",   band: "computational" },
  { index: 15, name: "Environmental Awareness",     group: "IV — Trust, Structure, Env",   band: "computational" },
  { index: 16, name: "Inter-Instance Coordination", group: "IV — Trust, Structure, Env",   band: "computational" },
  { index: 17, name: "Semantic Interface",          group: "V — Meaning and Adaptation",    band: "intelligence" },
  { index: 18, name: "Adaptive Optimization",       group: "V — Meaning and Adaptation",    band: "intelligence" },
  { index: 19, name: "Coherence Closure",           group: "VI — Coherence and Persistence", band: "intelligence" },
  { index: 20, name: "Self-Observation",            group: "VI — Coherence and Persistence", band: "intelligence" },
  { index: 21, name: "Intent Continuity",           group: "VI — Coherence and Persistence", band: "intelligence" },
  { index: 22, name: "External Compatibility",      group: "VI — Coherence and Persistence", band: "intelligence" },
] as const;

export const SCE88_DOMAINS = [
  "Domain A — Physical / Substrate",
  "Domain B — Control / Computational",
  "Domain C — Semantic / Interface",
  "Domain D — Temporal / Evolutionary",
] as const;

/** Event-kind → canonical level indices (1-22) it touches.
 *  An event can touch multiple levels (e.g. self-eval is L20). */
export const SCE88_EVENT_LEVEL_MAP: Record<string, number[]> = {
  "chat-stream":         [17],            // Semantic Interface
  "tool-call":           [11, 12],        // Execution Coordination + Correctness Enforcement
  "self-eval":           [20],            // Self-Observation (canonical)
  "auto-correction":     [8, 20],         // Fault Correction + Self-Observation
  "memory-consolidated": [18],            // Adaptive Optimization (learning)
  "recall-injection":    [18],
  "plan-saved":          [21],            // Intent Continuity
  "goal-push":           [21],
  "goal-pop":            [21],
  "goal-auto-pop":       [21, 22],        // + External Compatibility (closure on parent)
  "plan-complete":       [21, 22],
  "phase-error":         [19],            // Coherence Closure breach
  "bridge-message":      [16, 17],        // Inter-Instance Coordination + Semantic Interface
};

const counters = new Map<number, number>();
let totalEvents = 0;

export function tagEvent(kind: string): number[] {
  const levels = SCE88_EVENT_LEVEL_MAP[kind] ?? [];
  for (const l of levels) counters.set(l, (counters.get(l) ?? 0) + 1);
  if (levels.length > 0) totalEvents++;
  return levels;
}

export interface Sce88Stat {
  level: number;
  name: string;
  group: string;
  band: string;
  count: number;
  pct: number;
}

export function getSce88Stats(): Sce88Stat[] {
  const out: Sce88Stat[] = [];
  for (const [lvl, count] of counters.entries()) {
    const meta = SCE88_LEVELS.find((l) => l.index === lvl);
    if (!meta) continue;
    out.push({
      level: lvl,
      name: meta.name,
      group: meta.group,
      band: meta.band,
      count,
      pct: totalEvents > 0 ? (count / totalEvents) * 100 : 0,
    });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export function getSce88TotalEvents(): number { return totalEvents; }
