import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const PYTHON = "C:\\Users\\adz_7\\AppData\\Local\\Programs\\Python\\Python313\\python.exe";
const AUDIT_SCRIPT = "D:\\temp\\agi_search\\agi_capability_audit.py";

type StatusKind = "PASS" | "FAIL" | "PARTIAL" | "SKIP" | "SECTION";
interface AuditLine { kind: StatusKind; label: string; evidence: string; caveat: string }
interface Summary { pass: number; partial: number; fail: number; skip: number; total: number }

const RESULT_RE = /^\s*\[([✓✗~·])\s+(PASS|FAIL|PARTIAL|SKIP)\s*\]\s*(.+?)(?:\s{2,}(.*))?$/;
const SECTION_RE = /^\[(\d+)\]/;
const CAVEAT_RE  = /^\s*└\s*caveat:\s*(.+)$/;

function parseOutput(stdout: string): { lines: AuditLine[]; summary: Summary } {
  const rawLines = stdout.split("\n");
  const lines: AuditLine[] = [];
  const summary: Summary = { pass: 0, partial: 0, fail: 0, skip: 0, total: 0 };

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const m = raw.match(RESULT_RE);
    if (m) {
      const kind = m[2] as StatusKind;
      const entry: AuditLine = { kind, label: m[3].trim(), evidence: (m[4] ?? "").trim(), caveat: "" };
      if (i + 1 < rawLines.length) {
        const cm = rawLines[i + 1].match(CAVEAT_RE);
        if (cm) { entry.caveat = cm[1].trim(); i++; }
      }
      lines.push(entry);
      if (kind === "PASS") summary.pass++;
      else if (kind === "FAIL") summary.fail++;
      else if (kind === "PARTIAL") summary.partial++;
      else if (kind === "SKIP") summary.skip++;
    } else if (SECTION_RE.test(raw.trim())) {
      lines.push({ kind: "SECTION", label: raw.trim(), evidence: "", caveat: "" });
    }
    // parse summary block
    const pm = raw.match(/PASS:\s*(\d+)/); if (pm) summary.pass = parseInt(pm[1]);
    const fm = raw.match(/FAIL:\s*(\d+)/); if (fm) summary.fail = parseInt(fm[1]);
    const xm = raw.match(/PARTIAL:\s*(\d+)/); if (xm) summary.partial = parseInt(xm[1]);
    const tm = raw.match(/TOTAL:\s*(\d+)/); if (tm) summary.total = parseInt(tm[1]);
  }
  if (summary.total === 0) summary.total = summary.pass + summary.fail + summary.partial + summary.skip;
  return { lines, summary };
}

function badge(kind: StatusKind) {
  switch (kind) {
    case "PASS":    return "bg-emerald-900/70 text-emerald-300 border-emerald-700";
    case "FAIL":    return "bg-red-900/70 text-red-300 border-red-700";
    case "PARTIAL": return "bg-amber-900/60 text-amber-300 border-amber-700";
    case "SKIP":    return "bg-zinc-800 text-zinc-500 border-zinc-700";
    default:        return "bg-zinc-800 text-zinc-500 border-zinc-700";
  }
}

function icon(kind: StatusKind) {
  switch (kind) { case "PASS": return "✓"; case "FAIL": return "✗"; case "PARTIAL": return "~"; default: return "·"; }
}

export function AgiAudit({ onClose }: { onClose: () => void }) {
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<AuditLine[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rawOut, setRawOut] = useState("");
  const [error, setError] = useState("");
  const [rawOpen, setRawOpen] = useState(false);
  const [ranAt, setRanAt] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true); setError(""); setLines([]); setSummary(null); setRawOut("");
    try {
      const raw = await invoke<string>("xova_run", {
        command: `"${PYTHON}" "${AUDIT_SCRIPT}"`,
        cwd: "D:\\temp\\agi_search",
        elevated: false,
      });
      let stdout = raw, stderr = "", exit = 0;
      try { const w = JSON.parse(raw) as { stdout?: string; stderr?: string; exit?: number }; stdout = w.stdout ?? ""; stderr = w.stderr ?? ""; exit = w.exit ?? 0; } catch { /* raw */ }
      setRawOut(stdout + (stderr ? `\n--- stderr ---\n${stderr}` : ""));
      setRanAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      if (!stdout.trim() && exit !== 0) { setError(`exit ${exit}: ${stderr.slice(0, 400)}`); }
      else { const r = parseOutput(stdout); setLines(r.lines); setSummary(r.summary); }
    } catch (e) { setError(String(e)); }
    setRunning(false);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 50);
  }, [running]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 font-mono text-[11px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">
          AGI Audit{ranAt ? ` · ${ranAt}` : ""}
        </span>
        <button onClick={run} disabled={running}
          className="ml-auto px-3 py-0.5 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-40 rounded text-emerald-200 text-[9px] uppercase transition-colors">
          {running ? "running…" : "▶ Run"}
        </button>
        <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300">✕</button>
      </div>

      {running && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0 flex items-center gap-2">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
          <span className="text-zinc-500 text-[9px]">executing — may take 30–90s…</span>
        </div>
      )}

      {summary && !running && (
        <div className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 shrink-0 bg-zinc-900/40">
          <div className="flex flex-col gap-0.5">
            <span className="text-[8px] text-zinc-600 uppercase">passing</span>
            <span className="text-emerald-300 font-bold text-sm">{summary.pass}/{summary.total}</span>
          </div>
          <div className="flex-1 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: summary.total > 0 ? `${(summary.pass / summary.total) * 100}%` : "0%" }} />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            <span className={`px-1.5 py-0.5 rounded border text-[9px] ${badge("PASS")}`}>{summary.pass}✓</span>
            {summary.partial > 0 && <span className={`px-1.5 py-0.5 rounded border text-[9px] ${badge("PARTIAL")}`}>{summary.partial}~</span>}
            {summary.fail > 0 && <span className={`px-1.5 py-0.5 rounded border text-[9px] ${badge("FAIL")}`}>{summary.fail}✗</span>}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {!running && lines.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
            <span className="text-2xl">⬡</span>
            <span className="text-[10px]">27 AGI subsystems ready to audit</span>
            <button onClick={run} className="px-4 py-1.5 bg-emerald-800 hover:bg-emerald-700 rounded text-emerald-200 text-[10px] uppercase transition-colors">▶ Run Audit</button>
          </div>
        )}

        {error && !running && (
          <div className="p-3">
            <div className="bg-red-950/40 border border-red-800 rounded p-3">
              <div className="text-[9px] text-red-400 uppercase mb-1">error</div>
              <pre className="text-red-300 text-[10px] whitespace-pre-wrap break-all">{error}</pre>
            </div>
          </div>
        )}

        {lines.length > 0 && !running && (
          <div className="divide-y divide-zinc-900/50">
            {lines.map((line, i) => line.kind === "SECTION" ? (
              <div key={i} className="px-3 py-1.5 bg-zinc-900/60 border-l-2 border-zinc-700">
                <span className="text-[9px] text-zinc-500 uppercase tracking-wider">{line.label}</span>
              </div>
            ) : (
              <div key={i} className={`flex items-start gap-2 px-3 py-1.5 hover:bg-zinc-900/30 ${line.kind === "FAIL" ? "bg-red-950/10" : line.kind === "PARTIAL" ? "bg-amber-950/10" : ""}`}>
                <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border font-bold mt-0.5 w-[56px] text-center ${badge(line.kind)}`}>
                  {icon(line.kind)} {line.kind}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 text-[10px] truncate">{line.label}</div>
                  {line.evidence && <div className="text-zinc-500 text-[9px] truncate mt-0.5">{line.evidence}</div>}
                  {line.caveat && <div className="text-amber-500/80 text-[9px] mt-0.5">└ {line.caveat}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {rawOut && !running && (
          <div className="border-t border-zinc-800">
            <button onClick={() => setRawOpen(o => !o)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900/30 text-[9px] uppercase tracking-wider">
              <span>{rawOpen ? "▾" : "▸"}</span>
              <span>raw stdout</span>
              <span className="text-zinc-700 normal-case ml-auto">{rawOut.length.toLocaleString()} chars</span>
            </button>
            {rawOpen && (
              <pre className="px-3 pb-4 pt-1 text-[10px] text-zinc-500 whitespace-pre-wrap break-all border-t border-zinc-900">{rawOut}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
