import { useState } from "react";
import { evalTernExpression, parseTern, ternToStr, tNot, tAnd, tOr, tXor, tAdd, tMul, type Tern } from "@/lib/ziltrix_ternary";

const TERN_VALS: Tern[] = [1, 0, -1];
const LABEL: Record<Tern, string> = { "1": "T", "0": "U", "-1": "F" };
const COLOR: Record<Tern, string> = { "1": "text-emerald-400", "0": "text-amber-400", "-1": "text-red-400" };
const BG: Record<Tern, string> = { "1": "bg-emerald-900/40 border-emerald-700", "0": "bg-amber-900/30 border-amber-700", "-1": "bg-red-900/40 border-red-700" };

const OPS = [
  { label: "AND", fn: tAnd }, { label: "OR", fn: tOr },
  { label: "XOR", fn: tXor }, { label: "ADD", fn: tAdd }, { label: "MUL", fn: tMul },
];

const EXAMPLES = [
  "T AND F", "T OR U", "NOT U", "T XOR T", "+1 ADD -1", "T MUL F",
  "F OR U", "NOT F", "U AND T", "+1 XOR -1",
];

function TernBadge({ t }: { t: Tern }) {
  return <span className={`inline-block px-2 py-0.5 rounded border text-[11px] font-bold ${BG[t as unknown as keyof typeof BG]} ${COLOR[t as unknown as keyof typeof COLOR]}`}>{LABEL[t as unknown as keyof typeof LABEL]}</span>;
}

export function TernaryExplorer({ onClose }: { onClose: () => void }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<{ result: Tern; trace: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const evaluate = (e = expr) => {
    setError(null); setResult(null);
    try { setResult(evalTernExpression(e)); }
    catch (err) { setError(String(err)); }
  };

  const insert = (s: string) => { setExpr(s); evaluate(s); };

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">Ternary Logic (Ziltrix)</span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Expression input */}
        <div className="space-y-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Expression</div>
          <div className="flex gap-2">
            <input value={expr} onChange={e => setExpr(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") evaluate(); }}
              placeholder="e.g. T AND F  ·  NOT U  ·  +1 XOR -1"
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[12px] focus:outline-none focus:border-emerald-600 text-zinc-200 placeholder-zinc-600" />
            <button onClick={() => evaluate()}
              className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 rounded text-white text-[10px] uppercase tracking-wider">eval</button>
          </div>
          {result && (
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-2">
              <span className="text-zinc-500 text-[10px]">result</span>
              <TernBadge t={result.result} />
              <span className="text-zinc-500 text-[10px] ml-2">{result.trace}</span>
            </div>
          )}
          {error && <div className="text-red-400 text-[10px] bg-red-950/30 border border-red-800 rounded px-2 py-1">{error}</div>}
        </div>

        {/* Examples */}
        <div className="space-y-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Examples</div>
          <div className="flex flex-wrap gap-1">
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => insert(ex)}
                className="text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-emerald-700 rounded text-zinc-400 hover:text-emerald-300 transition-colors">
                {ex}
              </button>
            ))}
          </div>
        </div>

        {/* Binary truth tables */}
        <div className="space-y-2">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Truth Tables</div>
          <div className="overflow-x-auto">
            <table className="text-[10px] border-collapse">
              <thead>
                <tr>
                  <th className="text-zinc-600 px-2 py-1 border border-zinc-800">A</th>
                  <th className="text-zinc-600 px-2 py-1 border border-zinc-800">B</th>
                  {OPS.map(op => <th key={op.label} className="text-zinc-400 px-2 py-1 border border-zinc-800">{op.label}</th>)}
                  <th className="text-zinc-400 px-2 py-1 border border-zinc-800">NOT A</th>
                </tr>
              </thead>
              <tbody>
                {TERN_VALS.flatMap(a => TERN_VALS.map(b => (
                  <tr key={`${a}-${b}`} className="hover:bg-zinc-900/50">
                    <td className="px-2 py-0.5 border border-zinc-800 text-center"><TernBadge t={a} /></td>
                    <td className="px-2 py-0.5 border border-zinc-800 text-center"><TernBadge t={b} /></td>
                    {OPS.map(op => <td key={op.label} className="px-2 py-0.5 border border-zinc-800 text-center"><TernBadge t={op.fn(a, b)} /></td>)}
                    <td className="px-2 py-0.5 border border-zinc-800 text-center"><TernBadge t={tNot(a)} /></td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick parse reference */}
        <div className="space-y-1">
          <div className="text-[9px] text-zinc-500 uppercase tracking-wide">Value Aliases</div>
          <div className="grid grid-cols-3 gap-1 text-[10px]">
            {(["T/+1/1/TRUE", "U/0/UNKNOWN", "F/-1/FALSE"] as const).map((s, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-400">{s}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
