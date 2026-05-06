import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const CSV_PATH = "C:\\github\\wizardaax\\recursive-field-math-pro\\paper\\data\\ablation_metrics.csv";
const ALT_PATH = "D:\\github\\wizardaax\\recursive-field-math-pro\\paper\\data\\ablation_metrics.csv";

interface Row { [key: string]: string }

function parseCsv(raw: string): { headers: string[]; rows: Row[] } {
  const lines = raw.split("\n").filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim());
    const row: Row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

function numVal(v: string) {
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toFixed(2);
}

export function AblationMetrics({ onClose }: { onClose: () => void }) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      let raw = "";
      for (const path of [ALT_PATH, CSV_PATH]) {
        try { raw = await invoke<string>("xova_read_file", { path }); break; } catch { /* try next */ }
      }
      if (!raw) { setError("ablation_metrics.csv not found"); setLoading(false); return; }
      const { headers: h, rows: r } = parseCsv(raw);
      setHeaders(h); setRows(r);
      setLoading(false);
    })();
  }, []);

  const highlight = (row: Row) => row["config"]?.includes("phi") || row["config"]?.includes("φ");

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          Ablation Metrics {rows.length > 0 && `· ${rows.length} trials`}
        </span>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {loading && <div className="flex-1 flex items-center justify-center text-zinc-600">loading…</div>}
      {error && <div className="flex-1 flex items-center justify-center text-red-400">{error}</div>}

      {!loading && !error && (
        <div className="flex-1 overflow-auto p-2">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-zinc-800">
                {headers.map(h => (
                  <th key={h} className="text-left px-2 py-1 text-zinc-500 uppercase text-[9px] tracking-wider font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={`border-b border-zinc-900 ${highlight(row) ? "bg-emerald-950/30 text-emerald-300" : "hover:bg-zinc-900/40"}`}>
                  {headers.map(h => (
                    <td key={h} className="px-2 py-1 whitespace-nowrap">{numVal(row[h] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 text-[9px] text-zinc-600">φ-mod rows highlighted · source: paper/data/ablation_metrics.csv</div>
        </div>
      )}
    </div>
  );
}
