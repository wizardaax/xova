"""
memory_graph_builder.py — Xova plugin: unified memory graph index.

Collects nodes from:
  1. Forge memory .md files  (D:\\.claude\\projects\\C--Users-adz-7\\memory\\*.md)
  2. Xova git log            (C:\\Xova, last 50 commits)
  3. Snell-Vern git logs     (two repos, 20 commits each)
  4. mesh_feed.jsonl         (C:\\Xova\\memory\\mesh_feed.jsonl, last 30 lines)

Writes C:\\Xova\\memory\\memory_graph.json.
Prints one JSON line: {"ok": true, "node_count": N, "path": "...", "build_ms": N}
"""

import json
import os
import re
import subprocess
import time

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
FORGE_MEM_DIR = r"D:\.claude\projects\C--Users-adz-7\memory"
XOVA_REPO     = r"C:\Xova"
SV_REPO       = r"D:\github\wizardaax\Snell-Vern-Hybrid-Drive-Matrix"
RFM_REPO      = r"D:\github\wizardaax\recursive-field-math-pro"
MESH_FEED     = r"C:\Xova\memory\mesh_feed.jsonl"
OUT_PATH      = r"C:\Xova\memory\memory_graph.json"

# subprocess flag: no console window on Windows
NO_WINDOW = 0x08000000


# ---------------------------------------------------------------------------
# 1. Forge memory .md files
# ---------------------------------------------------------------------------
def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """Return (meta_dict, body_text). meta is empty if no --- delimiters."""
    meta: dict = {}
    body = text
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            fm_block = parts[1]
            body = parts[2].strip()
            for line in fm_block.splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    meta[k.strip()] = v.strip()
    return meta, body


def load_forge_memories() -> list[dict]:
    nodes: list[dict] = []
    if not os.path.isdir(FORGE_MEM_DIR):
        return nodes
    for fname in os.listdir(FORGE_MEM_DIR):
        if not fname.endswith(".md"):
            continue
        fpath = os.path.join(FORGE_MEM_DIR, fname)
        try:
            with open(fpath, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue

        meta, body = _parse_frontmatter(text)
        node_id = fname[:-3]  # strip .md
        ts = os.path.getmtime(fpath)
        nodes.append({
            "id":          node_id,
            "type":        meta.get("type", "reference"),
            "title":       meta.get("name", node_id),
            "description": meta.get("description", ""),
            "body":        body[:300],
            "tags":        [meta.get("type", "reference")],
            "ts":          ts,
            "source":      "forge_memory",
            "links":       [],
        })
    return nodes


# ---------------------------------------------------------------------------
# 2 & 3. Git log helpers
# ---------------------------------------------------------------------------
GIT_FMT = "--format=%H|%at|%s"


def _run_git_log(repo: str, n: int) -> list[str]:
    """Return raw log lines; empty list on any failure."""
    if not os.path.isdir(repo):
        return []
    try:
        result = subprocess.run(
            ["git", "-C", repo, "log", "--oneline", GIT_FMT, f"-n{n}"],
            capture_output=True, text=True,
            creationflags=NO_WINDOW, timeout=15,
        )
        return [l for l in result.stdout.splitlines() if l.strip()]
    except Exception:
        return []


def _parse_git_lines(lines: list[str], source: str) -> list[dict]:
    nodes: list[dict] = []
    for line in lines:
        parts = line.split("|", 2)
        if len(parts) < 3:
            continue
        sha, at_str, subject = parts
        try:
            ts = float(at_str)
        except ValueError:
            ts = 0.0
        nodes.append({
            "id":          sha[:12],
            "type":        "commit",
            "title":       subject.strip(),
            "description": "",
            "body":        subject.strip()[:300],
            "tags":        ["commit", source],
            "ts":          ts,
            "source":      source,
            "links":       [],
        })
    return nodes


def load_xova_commits() -> list[dict]:
    return _parse_git_lines(_run_git_log(XOVA_REPO, 50), "xova")


def load_sv_commits() -> list[dict]:
    nodes  = _parse_git_lines(_run_git_log(SV_REPO,  20), "snell-vern")
    nodes += _parse_git_lines(_run_git_log(RFM_REPO, 20), "rfm-pro")
    return nodes


# ---------------------------------------------------------------------------
# 4. mesh_feed.jsonl
# ---------------------------------------------------------------------------
def load_mesh_feed(n: int = 30) -> list[dict]:
    nodes: list[dict] = []
    if not os.path.isfile(MESH_FEED):
        return nodes
    try:
        with open(MESH_FEED, encoding="utf-8", errors="replace") as fh:
            raw_lines = fh.readlines()
    except OSError:
        return nodes

    for line in raw_lines[-n:]:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind     = obj.get("kind", "event")
        agent_id = obj.get("agent_id", "?")
        ts       = float(obj.get("ts", 0))
        title    = f"{kind} from {agent_id}"
        nodes.append({
            "id":          f"mesh_{int(ts * 1000)}_{agent_id}",
            "type":        "mesh",
            "title":       title,
            "description": obj.get("content", "")[:120],
            "body":        str(obj)[:300],
            "tags":        ["mesh", kind],
            "ts":          ts,
            "source":      "mesh_feed",
            "links":       [],
        })
    return nodes


# ---------------------------------------------------------------------------
# Auto-link: commit messages ↔ memory node titles (>3 word overlap)
# ---------------------------------------------------------------------------
def _word_set(text: str) -> set[str]:
    return {w.lower() for w in re.findall(r"[a-z]{4,}", text.lower())}


def build_links(nodes: list[dict]) -> None:
    memory_nodes = [n for n in nodes if n["source"] == "forge_memory"]
    commit_nodes = [n for n in nodes if n["type"] == "commit"]
    for commit in commit_nodes:
        c_words = _word_set(commit["title"])
        for mem in memory_nodes:
            m_words = _word_set(mem["title"] + " " + mem["description"])
            overlap = c_words & m_words
            if len(overlap) > 3:
                commit["links"].append(mem["id"])
                mem["links"].append(commit["id"])


# ---------------------------------------------------------------------------
# De-duplicate ids (sha collision guard)
# ---------------------------------------------------------------------------
def dedup(nodes: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for n in nodes:
        base = n["id"]
        uid  = base
        i    = 1
        while uid in seen:
            uid = f"{base}_{i}"
            i  += 1
        seen.add(uid)
        n["id"] = uid
        out.append(n)
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    t0 = time.time()

    nodes: list[dict] = []
    nodes += load_forge_memories()
    nodes += load_xova_commits()
    nodes += load_sv_commits()
    nodes += load_mesh_feed()
    nodes  = dedup(nodes)

    build_links(nodes)

    by_type: dict[str, list[str]] = {}
    for n in nodes:
        by_type.setdefault(n["type"], []).append(n["id"])

    graph = {
        "built_at":   time.time(),
        "node_count": len(nodes),
        "nodes":      nodes,
        "by_type":    by_type,
    }

    tmp = OUT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(graph, fh, ensure_ascii=False, indent=2, sort_keys=False)
    os.replace(tmp, OUT_PATH)

    build_ms = int((time.time() - t0) * 1000)
    print(json.dumps({
        "ok":         True,
        "node_count": len(nodes),
        "path":       OUT_PATH,
        "build_ms":   build_ms,
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        import traceback as _tb
        print(json.dumps({"ok": False, "error": str(exc),
                          "trace": _tb.format_exc()[-800:]}))
