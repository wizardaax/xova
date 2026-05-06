"""
ollama_queue.py — File-based priority queue for Ollama calls.

Priority: high (chat) > normal (voice) > low (background).
No threads. Pure file coordination.

Queue: C:\\Xova\\memory\\ollama_queue.jsonl
  Each line: {"id", "priority", "ts", "owner", "status", "payload"}

Usage:
    from ollama_queue import enqueue, dequeue, mark_done
    req_id = enqueue("high", "xova_chat", {"model": "llama3.2:3b", "prompt": "..."})
    item   = dequeue()
    if item:
        # ... call Ollama ...
        mark_done(item["id"])

Stdlib only: hashlib, json, os, time.
"""
from __future__ import annotations
import hashlib, json, os, time

QUEUE_FILE   = r"C:\Xova\memory\ollama_queue.jsonl"
LOCK_FILE    = r"C:\Xova\memory\ollama_queue.lock"
LOCK_TIMEOUT = 5.0
LOCK_POLL    = 0.05
_PRIORITY    = {"high": 0, "normal": 1, "low": 2}


def _qlock_acquire() -> bool:
    deadline = time.monotonic() + LOCK_TIMEOUT
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    while time.monotonic() < deadline:
        try:
            fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, json.dumps({"pid": os.getpid(), "ts": time.time()}).encode())
            os.close(fd)
            return True
        except FileExistsError:
            pass
        except Exception:
            return False
        time.sleep(LOCK_POLL)
    return False


def _qlock_release() -> None:
    try:
        os.unlink(LOCK_FILE)
    except FileNotFoundError:
        pass


def _read_all() -> list[dict]:
    try:
        with open(QUEUE_FILE, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def _write_all(items: list[dict]) -> None:
    os.makedirs(os.path.dirname(QUEUE_FILE), exist_ok=True)
    tmp = QUEUE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for item in items:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")
    os.replace(tmp, QUEUE_FILE)


def _make_id(owner: str, ts: float) -> str:
    return hashlib.sha256(f"{owner}:{ts}:{os.getpid()}".encode()).hexdigest()[:12]


def enqueue(priority: str, owner: str, payload: dict) -> str:
    if priority not in _PRIORITY:
        priority = "normal"
    ts  = time.time()
    req = {"id": _make_id(owner, ts), "priority": priority, "ts": ts,
           "owner": owner, "status": "pending", "payload": payload}
    if not _qlock_acquire():
        raise RuntimeError("ollama_queue: lock timeout on enqueue")
    try:
        items = _read_all()
        items.append(req)
        _write_all(items)
    finally:
        _qlock_release()
    return req["id"]


def dequeue() -> dict | None:
    if not _qlock_acquire():
        return None
    try:
        items   = _read_all()
        pending = [i for i in items if i.get("status") == "pending"]
        if not pending:
            return None
        pending.sort(key=lambda i: (_PRIORITY.get(i.get("priority", "normal"), 1), i.get("ts", 0)))
        chosen = pending[0]
        for item in items:
            if item["id"] == chosen["id"]:
                item["status"] = "running"
                item["started_at"] = time.time()
                break
        _write_all(items)
        return chosen
    finally:
        _qlock_release()


def mark_done(req_id: str, result: str | None = None) -> bool:
    if not _qlock_acquire():
        return False
    try:
        items, updated = _read_all(), False
        for item in items:
            if item["id"] == req_id:
                item["status"] = "done"
                item["finished_at"] = time.time()
                if result is not None:
                    item["result"] = result
                updated = True
                break
        if updated:
            _write_all(items)
        return updated
    finally:
        _qlock_release()


def queue_stats() -> dict:
    items  = _read_all()
    counts: dict[str, int] = {}
    for item in items:
        s = item.get("status", "unknown")
        counts[s] = counts.get(s, 0) + 1
    return {"total": len(items), "by_status": counts}
