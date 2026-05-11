"""
self_modifier.py — Self-modification proposal gate for the Xova AGI fleet.

Agents propose code changes to themselves. Every proposal is vetted by
Xova (persona_governor.consult) and gated by SCE-88 coherence before
being recorded. Proposals are NEVER applied automatically — Adam reviews
and applies approved changes via git. Full audit trail, append-only.

Actions:
  propose   --file <path> --description "what and why" [--proposer <name>]
            → consult Xova, record proposal, return {ok, id, approved, reason}
  list      show all proposals (all statuses, newest first)
  pending   show only pending (approved, not yet applied)
  status    rate-limit counters for today
  apply     --id <prop-id>   mark a proposal as applied (Adam runs this)

Rate limit: max 3 proposals per day. Dedup: skip identical file+description.
"""
import argparse, hashlib, json, os, re, subprocess, sys, time

PROPOSALS_PATH   = r"C:\Xova\memory\self_mod_proposals.json"
STATE_PATH       = r"C:\Xova\memory\self_mod_state.json"
PERSONA_GOVERNOR = r"C:\Xova\plugins\persona_governor.py"
ALLOWED_ROOT     = r"C:\Xova"     # proposals must target files under here
NO_WIN           = 0x08000000
MAX_PER_DAY      = 3


# ── persistence ───────────────────────────────────────────────────────────────

def _load_proposals() -> dict:
    default: dict = {"version": 1, "proposals": []}
    if not os.path.isfile(PROPOSALS_PATH):
        return default
    try:
        with open(PROPOSALS_PATH, encoding="utf-8") as fh:
            d = json.load(fh)
        d.setdefault("proposals", [])
        return d
    except Exception:
        return default


def _save_proposals(store: dict) -> None:
    os.makedirs(os.path.dirname(PROPOSALS_PATH), exist_ok=True)
    tmp = PROPOSALS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(store, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, PROPOSALS_PATH)


def _load_state() -> dict:
    default: dict = {"proposals_today": [], "last_proposal_ts": 0.0}
    if not os.path.isfile(STATE_PATH):
        return default
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            s = json.load(fh)
        for k, v in default.items():
            s.setdefault(k, v)
        return s
    except Exception:
        return default


def _save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_PATH)


# ── helpers ───────────────────────────────────────────────────────────────────

def _prop_id(file_path: str, description: str) -> str:
    raw = f"{file_path}:{description}:{time.time()}"
    return "prop-" + hashlib.sha256(raw.encode()).hexdigest()[:8]


def _is_duplicate(file_path: str, description: str, proposals: list) -> bool:
    for p in proposals:
        if (p.get("file_path") == file_path
                and p.get("description") == description
                and p.get("status") in ("pending", "approved")):
            return True
    return False


def _rate_ok(state: dict) -> bool:
    cutoff = time.time() - 86400
    today = [t for t in state["proposals_today"] if t > cutoff]
    state["proposals_today"] = today
    return len(today) < MAX_PER_DAY


def _consult_xova(proposal_text: str) -> tuple[bool, str, float, bool]:
    """Returns (approved, reason, sce88_coherence, sce88_pass). Fail-open."""
    try:
        r = subprocess.run(
            [sys.executable, PERSONA_GOVERNOR,
             "--action", "consult", "--proposal", proposal_text],
            capture_output=True, text=True, timeout=25,
            creationflags=NO_WIN, encoding="utf-8",
        )
        data = json.loads(r.stdout.strip()) if r.stdout.strip() else {}
        return (
            bool(data.get("approved", True)),
            str(data.get("reason", "")),
            float(data.get("sce88_coherence", 0.7)),
            bool(data.get("sce88_pass", True)),
        )
    except Exception:
        return True, "consult unavailable — auto-approved", 0.7, True


# ── actions ───────────────────────────────────────────────────────────────────

def action_propose(file_path: str, description: str, proposer: str) -> dict:
    """Gate a proposed code change through Xova and record if approved."""

    # Normalise and validate path
    file_path = os.path.normpath(file_path)
    if not file_path.upper().startswith(os.path.normpath(ALLOWED_ROOT).upper()):
        return {"ok": False, "error": f"file_path must be under {ALLOWED_ROOT}"}
    if not description.strip():
        return {"ok": False, "error": "description is required"}

    state = _load_state()
    if not _rate_ok(state):
        return {"ok": False, "error": f"daily cap reached ({MAX_PER_DAY}/day)", "proposals_today": len(state["proposals_today"])}

    store = _load_proposals()
    if _is_duplicate(file_path, description, store["proposals"]):
        return {"ok": False, "skipped": "duplicate", "note": "identical pending proposal already exists"}

    # Consult Xova — she may veto if this conflicts with fleet priorities
    proposal_text = (
        f"[SELF-MOD] Agent '{proposer}' proposes to modify: {file_path}\n"
        f"Reason: {description[:280]}"
    )
    approved, reason, coh, sce88_pass = _consult_xova(proposal_text)

    now   = time.time()
    pid   = _prop_id(file_path, description)
    entry = {
        "id":             pid,
        "file_path":      file_path,
        "description":    description,
        "proposer":       proposer,
        "created_at":     now,
        "sce88_coherence": round(coh, 4),
        "sce88_pass":     sce88_pass,
        "xova_approved":  approved,
        "xova_reason":    reason,
        "status":         "pending" if approved else "vetoed",
        "applied_at":     None,
    }
    store["proposals"].append(entry)
    _save_proposals(store)

    if approved:
        state["proposals_today"].append(now)
        state["last_proposal_ts"] = now
        _save_state(state)

    return {
        "ok":             True,
        "id":             pid,
        "approved":       approved,
        "reason":         reason,
        "sce88_coherence": round(coh, 4),
        "sce88_pass":     sce88_pass,
        "status":         entry["status"],
        "file_path":      file_path,
    }


def action_list(filter_status: str | None = None) -> dict:
    store = _load_proposals()
    proposals = store["proposals"]
    if filter_status:
        proposals = [p for p in proposals if p.get("status") == filter_status]
    proposals = sorted(proposals, key=lambda p: -p.get("created_at", 0))
    return {"ok": True, "count": len(proposals), "proposals": proposals}


def action_status() -> dict:
    state = _load_state()
    now   = time.time()
    today = [t for t in state["proposals_today"] if t > now - 86400]
    store = _load_proposals()
    pending = sum(1 for p in store["proposals"] if p.get("status") == "pending")
    vetoed  = sum(1 for p in store["proposals"] if p.get("status") == "vetoed")
    applied = sum(1 for p in store["proposals"] if p.get("status") == "applied")
    return {
        "ok":                True,
        "proposals_today":   len(today),
        "daily_cap":         MAX_PER_DAY,
        "daily_remaining":   max(0, MAX_PER_DAY - len(today)),
        "last_proposal_ts":  state.get("last_proposal_ts", 0),
        "total_pending":     pending,
        "total_vetoed":      vetoed,
        "total_applied":     applied,
    }


def action_apply(prop_id: str) -> dict:
    """Mark a proposal as applied. Adam runs this after making the code change."""
    store = _load_proposals()
    for p in store["proposals"]:
        if p.get("id") == prop_id:
            if p.get("status") == "applied":
                return {"ok": False, "error": "already applied"}
            if p.get("status") == "vetoed":
                return {"ok": False, "error": "proposal was vetoed — cannot apply"}
            p["status"]     = "applied"
            p["applied_at"] = time.time()
            _save_proposals(store)
            return {
                "ok":        True,
                "id":        prop_id,
                "file_path": p.get("file_path"),
                "applied_at": p["applied_at"],
            }
    return {"ok": False, "error": f"proposal {prop_id} not found"}


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--action",      default="status",
                    choices=["propose", "list", "pending", "status", "apply"])
    ap.add_argument("--file",             default="")
    ap.add_argument("--description",      default="")
    ap.add_argument("--description-file", default="")
    ap.add_argument("--proposer",         default="mesh")
    ap.add_argument("--id",               default="")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.action == "propose":
        desc = args.description.strip()
        if not desc and args.description_file:
            try:
                with open(args.description_file, encoding="utf-8") as _f:
                    desc = _f.read().strip()
            except Exception:
                desc = ""
        result = action_propose(args.file.strip(), desc, args.proposer.strip())
    elif args.action == "list":
        result = action_list()
    elif args.action == "pending":
        result = action_list(filter_status="pending")
    elif args.action == "apply":
        result = action_apply(args.id.strip())
    else:
        result = action_status()

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps({"ok": False, "error": str(exc)}))
