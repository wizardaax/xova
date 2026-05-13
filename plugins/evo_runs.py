"""List recent evolution run summaries from memory/evolution/."""
import os, json, sys

EVO_DIR = "C:/Xova/memory/evolution"

def main():
    limit = 30
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            try: limit = int(arg.split("=")[1])
            except: pass

    try:
        files = sorted(
            [f for f in os.listdir(EVO_DIR) if f.endswith("_evolve.json")]
        )[-limit:]
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)})); return

    runs = []
    for fname in reversed(files):  # newest first
        try:
            with open(os.path.join(EVO_DIR, fname), encoding="utf-8") as fh:
                d = json.load(fh)
            obs = d.get("observed", {})
            app = d.get("applied", {})
            runs.append({
                "filename": fname,
                "ts": d.get("ts", 0),
                "gaps_found":  len(obs.get("gaps", [])),
                "proposed":    len(d.get("proposed", [])),
                "applied":     len(app.get("changes", [])) if isinstance(app, dict) else 0,
                "coherence":   obs.get("coherence"),
                "mean_health": obs.get("summary", {}).get("mean_health"),
                "auto_merge":  app.get("auto_merge", False) if isinstance(app, dict) else False,
            })
        except: pass

    print(json.dumps({"ok": True, "runs": runs, "total_files": len(files)}))

if __name__ == "__main__":
    main()
