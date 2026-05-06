"""mesh_snapshot.py — dump current mesh state to C:\Xova\memory\mesh_snapshot.json.
Stdlib only: os, json, time, datetime, glob.
Atomic write: .tmp + os.replace.
"""
import os
import json
import time
import glob
from datetime import datetime, timezone

BOARD_PATH    = r"C:\Xova\memory\agent_board.json"
FEED_PATH     = r"C:\Xova\memory\mesh_feed.jsonl"
FORGE_PATH    = r"C:\Xova\memory\forge_events.jsonl"
EVOLVE_GLOB   = r"C:\Xova\memory\evolution\*_evolve.json"
SNAP_PATH     = r"C:\Xova\memory\mesh_snapshot.json"
SNAP_TMP      = SNAP_PATH + ".tmp"


def read_json_file(path):
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def tail_jsonl(path, n=5):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        lines = f.readlines()
    results = []
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            results.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(results) >= n:
            break
    results.reverse()
    return results


def count_lines(path):
    if not os.path.exists(path):
        return 0
    count = 0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                count += 1
    return count


def main():
    now = time.time()
    ts_iso = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()

    board           = read_json_file(BOARD_PATH)
    recent_feed     = tail_jsonl(FEED_PATH, 5)
    recent_forge    = tail_jsonl(FORGE_PATH, 5)
    feed_total      = count_lines(FEED_PATH)
    evolve_files    = glob.glob(EVOLVE_GLOB)
    evolution_count = len(evolve_files)

    snap = {
        "ts":               now,
        "ts_iso":           ts_iso,
        "board":            board,
        "recent_feed":      recent_feed,
        "recent_forge":     recent_forge,
        "feed_total_lines": feed_total,
        "evolution_count":  evolution_count,
    }

    with open(SNAP_TMP, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    os.replace(SNAP_TMP, SNAP_PATH)

    print(json.dumps(snap, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
