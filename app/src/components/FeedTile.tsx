import { useEffect, useState } from "react";
import { X, Pencil, Plus } from "@phosphor-icons/react";
import { saveMemory, loadMemory } from "@/lib/mesh";

const FEEDS_KEY = "feeds";

interface Feed {
  id: string;
  label: string;
  url: string;
  /** "iframe" = embed full page; "snapshot" = poll <img> every refreshSec for cams that expose JPEG snapshot URLs */
  mode: "iframe" | "snapshot";
  refreshSec?: number;
}

interface FeedTileProps {
  onClose: () => void;
}

const DEFAULT_FEED: Feed = {
  id: "default",
  label: "feed",
  url: "",
  mode: "iframe",
};

/**
 * Multi-feed embed panel for tablet/security-cam dashboards.
 * - iframe mode: any web URL (security cam web UI, dashboards). May be blocked
 *   by X-Frame-Options on some sites.
 * - snapshot mode: polls a static-image URL every N seconds (works for niview/
 *   V380/ONVIF cams that expose /snapshot.jpg or /onvif-http/snapshot endpoints).
 */
export function FeedTile({ onClose }: FeedTileProps) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Feed>({ ...DEFAULT_FEED });
  const [hydrated, setHydrated] = useState<boolean>(false);
  const [tick, setTick] = useState<number>(0);

  useEffect(() => {
    loadMemory<Feed[]>(FEEDS_KEY).then((stored) => {
      if (Array.isArray(stored) && stored.length > 0) {
        setFeeds(stored);
      } else {
        setEditingId("new");
        setDraft({ ...DEFAULT_FEED, id: `f-${Date.now()}` });
      }
      setHydrated(true);
    });
  }, []);

  // Periodic refresh tick for snapshot-mode feeds.
  useEffect(() => {
    const handle = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(handle);
  }, []);

  const persist = async (next: Feed[]) => {
    setFeeds(next);
    try { await saveMemory(FEEDS_KEY, next); } catch {}
  };

  const startNew = () => {
    setEditingId("new");
    setDraft({ id: `f-${Date.now()}`, label: "feed", url: "", mode: "iframe", refreshSec: 2 });
  };

  const startEdit = (f: Feed) => {
    setEditingId(f.id);
    setDraft({ ...f, refreshSec: f.refreshSec ?? 2 });
  };

  const saveDraft = async () => {
    const url = draft.url.trim();
    if (!url) return;
    const cleaned: Feed = { ...draft, url, label: draft.label.trim() || "feed" };
    const idx = feeds.findIndex((f) => f.id === cleaned.id);
    const next = idx >= 0 ? feeds.map((f, i) => (i === idx ? cleaned : f)) : [...feeds, cleaned];
    await persist(next);
    setEditingId(null);
  };

  const remove = async (id: string) => {
    await persist(feeds.filter((f) => f.id !== id));
    if (editingId === id) setEditingId(null);
  };

  return (
    <div className="px-6 pb-2 shrink-0 flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
        <span className="uppercase tracking-wider">feeds ({feeds.length})</span>
        <button
          onClick={startNew}
          title="Add a feed"
          className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-emerald-400"
        >
          <Plus size={12} />
        </button>
        <button
          onClick={onClose}
          title="Hide all feeds"
          className="w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-red-400"
        >
          <X size={12} />
        </button>
      </div>

      {/* Editor (new or existing) */}
      {editingId !== null && (
        <div className="w-full max-w-[660px] border border-zinc-800 rounded p-2 bg-zinc-900 flex flex-col gap-1">
          <div className="flex gap-2">
            <input
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="label (e.g. front room)"
              className="w-32 h-7 px-2 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
            <input
              value={draft.url}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder="http://192.168.x.x/snapshot.jpg  OR  https://web-ui-url"
              onKeyDown={(e) => { if (e.key === "Enter") saveDraft(); }}
              className="flex-1 h-7 px-2 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div className="flex gap-2 items-center text-[10px] font-mono text-zinc-500">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={draft.mode === "iframe"}
                onChange={() => setDraft((d) => ({ ...d, mode: "iframe" }))}
              />
              iframe (web UI / dashboard)
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={draft.mode === "snapshot"}
                onChange={() => setDraft((d) => ({ ...d, mode: "snapshot" }))}
              />
              snapshot poll (cam JPEG URL)
            </label>
            {draft.mode === "snapshot" && (
              <span>
                refresh
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={draft.refreshSec ?? 2}
                  onChange={(e) => setDraft((d) => ({ ...d, refreshSec: Math.max(1, parseInt(e.target.value || "2", 10)) }))}
                  className="w-12 h-5 mx-1 px-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-100 text-[10px]"
                />
                s
              </span>
            )}
            <button
              onClick={saveDraft}
              disabled={!draft.url.trim()}
              className="ml-auto h-6 px-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded"
            >
              save
            </button>
            <button
              onClick={() => setEditingId(null)}
              className="h-6 px-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {/* Live feeds — render side by side, wrapping */}
      {hydrated && feeds.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {feeds.map((f) => {
            const refresh = Math.max(1, f.refreshSec ?? 2);
            const cacheBust = f.mode === "snapshot"
              ? `${f.url}${f.url.includes("?") ? "&" : "?"}_t=${Math.floor(tick / refresh)}`
              : f.url;
            return (
              <div key={f.id} className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 w-full max-w-[320px]">
                  <span className="text-zinc-300 truncate">{f.label}</span>
                  <span className="text-zinc-600 truncate flex-1">{f.url}</span>
                  <button onClick={() => startEdit(f)} title="Edit" className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-emerald-400">
                    <Pencil size={10} />
                  </button>
                  <button onClick={() => remove(f.id)} title="Remove" className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-red-400">
                    <X size={11} />
                  </button>
                </div>
                {f.mode === "iframe" ? (
                  <iframe
                    src={f.url}
                    title={f.label}
                    allow="camera; microphone; autoplay; fullscreen"
                    referrerPolicy="no-referrer"
                    className="rounded border border-emerald-700 bg-black"
                    style={{ width: 320, height: 240 }}
                  />
                ) : (
                  <img
                    src={cacheBust}
                    alt={f.label}
                    referrerPolicy="no-referrer"
                    className="rounded border border-emerald-700 bg-black object-cover"
                    style={{ width: 320, height: 240 }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "0.4"; }}
                    onLoad={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = "1"; }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
