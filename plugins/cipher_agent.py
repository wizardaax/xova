"""
cipher_agent.py — Xova swarm agent for WormCipher + Kryptos research.

Bridges Adam's cryptographic research (Cypher worm_250829, Kryptos passes 1-2,
Worm _250905) into the mesh agent network. Runs analysis tasks, verifies
WormCipher round-trips, feeds results to the corpus and mesh_feed.

Actions:
  status          current known state + corpus hits on cipher topics
  roundtrip_test  verify WormCipher encrypt/decrypt self-consistency
  kryptos_status  summarise what Kryptos passes covered (from corpus)
  scan_papers     index cypher papers from ziltrix-sch-core into goal suggestions
  propose         propose a cipher research task to self_modifier/goal_store

Rate limit: 5 actions per hour (cipher analysis is heavy).
Stdlib only.
"""
import argparse, hashlib, json, os, sys, time

MESH_FEED       = r"C:\Xova\memory\mesh_feed.jsonl"
CORPUS_INDEX    = r"C:\Xova\memory\corpus_index.json"
GOAL_STORE      = r"C:\Xova\memory\goal_store.json"
WORM_CIPHER     = r"D:\temp\worm_cipher_fixed.py"
PAPERS_DIR      = r"D:\github\wizardaax\ziltrix-sch-core"
STATE_PATH      = r"C:\Xova\memory\cipher_agent_state.json"
AGENT_ID        = "cipher"
LABEL           = "Cipher Agent"


# ── persistence ───────────────────────────────────────────────────────────────

def _load_state() -> dict:
    default: dict = {"actions_this_hour": [], "last_action_ts": 0.0, "kryptos_passes": [], "roundtrip_ok": None}
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            s = json.load(fh)
        for k, v in default.items():
            s.setdefault(k, v)
        return s
    except Exception:
        return default


def _save_state(s: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(s, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_PATH)


def _emit(kind: str, content: str, coherence: float = 0.75) -> None:
    os.makedirs(os.path.dirname(MESH_FEED), exist_ok=True)
    entry = {
        "ts":       time.time(),
        "kind":     kind,
        "agent_id": AGENT_ID,
        "label":    LABEL,
        "content":  content,
        "coherence": coherence,
    }
    try:
        with open(MESH_FEED, encoding="utf-8") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        lines = []
    lines.append(json.dumps(entry, ensure_ascii=False) + "\n")
    if len(lines) > 5000:
        lines = lines[-4999:]
    with open(MESH_FEED, "w", encoding="utf-8") as fh:
        fh.writelines(lines)


def _rate_ok(state: dict) -> bool:
    cutoff = time.time() - 3600
    today = [t for t in state["actions_this_hour"] if t > cutoff]
    state["actions_this_hour"] = today
    return len(today) < 5


# ── corpus search ─────────────────────────────────────────────────────────────

def _corpus_search(query: str, top_n: int = 5) -> list[dict]:
    try:
        with open(CORPUS_INDEX, encoding="utf-8") as fh:
            corpus = json.load(fh)
        entries = corpus if isinstance(corpus, list) else corpus.get("entries", [])
        q = set(query.lower().split())
        hits = []
        for e in entries:
            text = (e.get("title", "") + " " + e.get("content", "") + " " + e.get("path", "")).lower()
            score = sum(1 for w in q if w in text)
            if score > 0:
                hits.append((score, e))
        hits.sort(key=lambda x: -x[0])
        return [h for _, h in hits[:top_n]]
    except Exception:
        return []


# ── actions ───────────────────────────────────────────────────────────────────

def action_status() -> dict:
    state = _load_state()
    hits = _corpus_search("cipher cypher kryptos worm crypto")
    papers = []
    for p in ["Cypher worm_250829_004121", "Kryptos cypher update 1", "Kryptos update 2", "Worm  _250905", "Xova evolution cypher"]:
        full = os.path.join(PAPERS_DIR, p + ".pdf")
        if not os.path.exists(full):
            full = os.path.join(PAPERS_DIR, p + ".docx")
        papers.append({"name": p, "exists": os.path.exists(full)})
    worm_ok = os.path.exists(WORM_CIPHER)
    _emit("agent_result", f"cipher status · {len(hits)} corpus hits · worm_impl={worm_ok} · papers={sum(p['exists'] for p in papers)}/{len(papers)}")
    return {
        "ok":              True,
        "corpus_hits":     len(hits),
        "top_hit":         hits[0].get("title", "") if hits else "",
        "papers_found":    sum(p["exists"] for p in papers),
        "papers_total":    len(papers),
        "worm_impl_path":  WORM_CIPHER,
        "worm_impl_ok":    worm_ok,
        "roundtrip_ok":    state.get("roundtrip_ok"),
        "last_action":     state.get("last_action_ts"),
    }


def action_roundtrip_test() -> dict:
    """Import and verify WormCipher encrypt/decrypt round-trip. Stdlib only — uses importlib."""
    state = _load_state()
    if not _rate_ok(state):
        return {"ok": False, "error": "rate limit 5/h"}
    if not os.path.exists(WORM_CIPHER):
        return {"ok": False, "error": f"WormCipher not found at {WORM_CIPHER}"}

    import importlib.util
    spec = importlib.util.spec_from_file_location("worm_cipher_fixed", WORM_CIPHER)
    worm_mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(worm_mod)  # type: ignore
    except Exception as e:
        return {"ok": False, "error": f"import failed: {e}"}

    # Run a round-trip on a known plaintext
    plaintext = b"AEON RFF WormCipher round-trip test v2 - golden angle phi spiral"
    passphrase = "X1_Worm_Key_v2"
    try:
        WormCipher = getattr(worm_mod, "WormCipher", None)
        if not WormCipher:
            return {"ok": False, "error": "WormCipher class not found in module"}
        enc = WormCipher(passphrase)
        dec = WormCipher(passphrase)
        ciphertext = enc.encrypt_bytes(plaintext)
        recovered  = dec.decrypt_bytes(ciphertext)
        ok = recovered == plaintext
        state["roundtrip_ok"] = ok
        state["actions_this_hour"].append(time.time())
        state["last_action_ts"] = time.time()
        _save_state(state)
        _emit("agent_result", f"cipher roundtrip · {'PASS' if ok else 'FAIL'} · len={len(ciphertext)}b", coherence=0.9 if ok else 0.3)
        return {
            "ok":          True,
            "roundtrip":   ok,
            "plaintext_len":   len(plaintext),
            "ciphertext_len":  len(ciphertext),
            "sha256_plaintext": hashlib.sha256(plaintext).hexdigest()[:16],
        }
    except Exception as e:
        _emit("agent_result", f"cipher roundtrip · EXCEPTION: {str(e)[:60]}", coherence=0.2)
        return {"ok": False, "error": str(e)}


def action_scan_papers() -> dict:
    """Scan ziltrix-sch-core for cipher papers and emit goal suggestions."""
    state = _load_state()
    if not _rate_ok(state):
        return {"ok": False, "error": "rate limit 5/h"}

    target_names = [
        "Cypher worm_250829_004121",
        "Kryptos cypher update 1_250803_104647",
        "Kryptos update 2_250803_110011",
        "Worm  _250905_012914",
        "Xova evolution cypher _250912_010334",
        "Code hiding_250820_120957",
    ]
    found = []
    for name in target_names:
        for ext in (".pdf", ".docx"):
            full = os.path.join(PAPERS_DIR, name + ext)
            if os.path.exists(full):
                found.append({"name": name, "ext": ext, "path": full})
                break

    state["actions_this_hour"].append(time.time())
    state["last_action_ts"] = time.time()
    _save_state(state)
    _emit("agent_result", f"cipher scan · {len(found)}/{len(target_names)} papers located in ziltrix-sch-core")
    return {"ok": True, "papers_found": len(found), "papers": found}


def action_kryptos_status() -> dict:
    """Report on Kryptos analysis coverage from corpus."""
    hits = _corpus_search("kryptos cypher update analysis pass")
    passes_found = sum(1 for h in hits if "kryptos" in h.get("title", "").lower() or "kryptos" in h.get("content", "").lower())
    _emit("agent_result", f"cipher kryptos · {passes_found} corpus entries · {len(hits)} related hits")
    return {
        "ok":            True,
        "kryptos_corpus_hits": passes_found,
        "related_hits":  len(hits),
        "top_results":   [h.get("title", h.get("path", "")[:60]) for h in hits[:3]],
    }


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action", default="status",
                    choices=["status", "roundtrip_test", "scan_papers", "kryptos_status"])
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.action == "roundtrip_test":
        result = action_roundtrip_test()
    elif args.action == "scan_papers":
        result = action_scan_papers()
    elif args.action == "kryptos_status":
        result = action_kryptos_status()
    else:
        result = action_status()

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
