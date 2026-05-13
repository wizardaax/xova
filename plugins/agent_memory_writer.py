"""
agent_memory_writer.py — copy each agent's own inbox/outbox files into its
repo's memory/ dir. Skip files over MAX_SIZE_BYTES so big shared resources
(corpus_index.json, mesh_feed.jsonl, anything that grows) don't get duped
into 13 places.

Stdlib only.

CLI:
    python agent_memory_writer.py
"""
import json, os, shutil

REPOS_DIR      = r"D:\github\wizardaax"
MAX_SIZE_BYTES = 100_000   # 100 KB — bigger than this, skip (too big to dupe per-agent)


def run():
    out = {}
    for name in sorted(os.listdir(REPOS_DIR)):
        if not name.startswith("xova-agent-"):
            continue
        repo = os.path.join(REPOS_DIR, name)
        identity_path = os.path.join(repo, "agent_identity.json")
        memory_dir = os.path.join(repo, "memory")
        if not (os.path.isfile(identity_path) and os.path.isdir(memory_dir)):
            continue
        with open(identity_path, encoding="utf-8") as fh:
            identity = json.load(fh)
        copied, skipped = [], []
        for key in ("inbox", "outbox"):
            src = identity.get(key, "")
            if not (src and os.path.isfile(src)):
                continue
            sz = os.path.getsize(src)
            if sz > MAX_SIZE_BYTES:
                skipped.append(f"{os.path.basename(src)} ({sz} bytes)")
                continue
            dst = os.path.join(memory_dir, os.path.basename(src))
            shutil.copy2(src, dst)
            copied.append(os.path.basename(src))
        out[name] = {"copied": copied, "skipped": skipped} if skipped else copied
    return out


if __name__ == "__main__":
    print(json.dumps(run(), indent=2, ensure_ascii=False))
