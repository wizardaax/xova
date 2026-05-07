"""
fact_federation.py — Round 107: Cross-AI fact federation.

Reads Jarvis's SQLite memory_nodes + conversation_summaries and Xova's
xova_standing_facts.json, merges them into shared_facts.json. Both systems
can read this file. Stdlib only, read-only access to Jarvis DB.

CLI:
  python fact_federation.py sync   -- merge and write shared_facts.json
  python fact_federation.py show   -- print current shared facts
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import time

JARVIS_DB         = r"C:\Users\adz_7\.local\share\jarvis\jarvis.db"
XOVA_FACTS        = r"C:\Xova\memory\xova_standing_facts.json"
SHARED_FACTS      = r"C:\Xova\memory\shared_facts.json"
XOVA_SYNC_FACTS   = r"C:\Xova\memory\xova_sync_facts.json"

# How many conversation summaries to pull
SUMMARY_LIMIT = 5
# How many memory_nodes to pull (skip root/directives)
NODE_SKIP = {"root", "directives"}


def _read_jarvis_nodes() -> list[dict]:
    if not os.path.exists(JARVIS_DB):
        return []
    try:
        conn = sqlite3.connect(f"file:{JARVIS_DB}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, description, created_at, updated_at "
            "FROM memory_nodes WHERE id NOT IN ("
            + ",".join("?" * len(NODE_SKIP))
            + ") ORDER BY updated_at DESC",
            tuple(NODE_SKIP),
        )
        rows = [dict(row) for row in cur.fetchall()]
        conn.close()
        return rows
    except Exception as exc:
        print(f"[fact_federation] jarvis nodes read failed: {exc}")
        return []


def _read_jarvis_summaries() -> list[dict]:
    if not os.path.exists(JARVIS_DB):
        return []
    try:
        conn = sqlite3.connect(f"file:{JARVIS_DB}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT date_utc, summary, topics FROM conversation_summaries "
            "ORDER BY ts_utc DESC LIMIT ?",
            (SUMMARY_LIMIT,),
        )
        rows = [dict(row) for row in cur.fetchall()]
        conn.close()
        return rows
    except Exception as exc:
        print(f"[fact_federation] jarvis summaries read failed: {exc}")
        return []


def _read_xova_facts() -> list[str]:
    try:
        raw = json.load(open(XOVA_FACTS, encoding="utf-8"))
        if isinstance(raw, list):
            return [str(f) for f in raw if isinstance(f, str) and len(f) > 5]
        return []
    except Exception:
        return []


def _read_xova_sync_facts() -> dict:
    try:
        return json.load(open(XOVA_SYNC_FACTS, encoding="utf-8"))
    except Exception:
        return {}


def sync() -> dict:
    nodes    = _read_jarvis_nodes()
    summaries = _read_jarvis_summaries()
    xova_facts = _read_xova_facts()
    xova_sync  = _read_xova_sync_facts()

    shared = {
        "version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "jarvis": {
            "memory_nodes": [
                {
                    "name":        n["name"],
                    "description": n["description"],
                    "updated_at":  n["updated_at"],
                }
                for n in nodes
            ],
            "recent_conversations": [
                {
                    "date":    s["date_utc"],
                    "summary": s["summary"][:300] if s["summary"] else "",
                    "topics":  s["topics"] or "",
                }
                for s in summaries
            ],
        },
        "xova": {
            "standing_facts": xova_facts,
            "sync_facts":     xova_sync,
        },
    }

    tmp = SHARED_FACTS + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(shared, f, indent=2, ensure_ascii=False)
    os.replace(tmp, SHARED_FACTS)

    stats = (
        f"{len(nodes)} nodes + {len(summaries)} summaries from Jarvis · "
        f"{len(xova_facts)} Xova facts · "
        f"written to {os.path.basename(SHARED_FACTS)}"
    )
    print(f"[fact_federation] sync: {stats}")
    return shared


def show() -> None:
    if not os.path.exists(SHARED_FACTS):
        print("shared_facts.json does not exist — run sync first")
        return
    data = json.load(open(SHARED_FACTS, encoding="utf-8"))
    print(f"shared_facts.json  generated: {data.get('generated_at')}")
    print()
    print("=== JARVIS memory nodes ===")
    for n in data["jarvis"]["memory_nodes"]:
        print(f"  {n['name']}: {n['description'][:80]}")
    print()
    print("=== JARVIS recent conversations ===")
    for s in data["jarvis"]["recent_conversations"]:
        print(f"  [{s['date']}] {s['summary'][:100]}")
    print()
    print("=== XOVA standing facts ===")
    for f in data["xova"]["standing_facts"]:
        print(f"  {f}")
    print()
    print("=== XOVA sync facts ===")
    sf = data["xova"]["sync_facts"]
    for k in list(sf.keys())[:10]:
        print(f"  {k}: {str(sf[k])[:80]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Round 107: Cross-AI fact federation")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("sync")
    sub.add_parser("show")
    args = parser.parse_args()

    if args.cmd == "sync":
        sync()
    elif args.cmd == "show":
        show()
    else:
        parser.print_help()
