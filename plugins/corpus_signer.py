"""
corpus_signer.py — Round 108: RSA-2048 integrity signing for corpus entries.

Signs manually-added corpus entries (root field absent) so future readers
can verify they haven't been tampered with.  100-year design: stdlib only,
key stored as JSON hex strings, signatures are PKCS#1-v1.5 SHA-256.

Signing canonical: SHA-256 of json.dumps({title, content, path}, sort_keys=True)
Signature stored inline as entry["rsa_sig"] (hex, 512 chars for 2048-bit key).
Public key fingerprint stored as entry["rsa_key_fp"] (first 16 hex chars of
SHA-256 of the public modulus n).

CLI:
  python corpus_signer.py sign    -- sign all unsigned manual entries
  python corpus_signer.py verify  -- verify all signed entries
  python corpus_signer.py status  -- count signed/unsigned/failed
  python corpus_signer.py genkey  -- generate and save a new signing key
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time

CORPUS_PATH     = r"C:\Xova\memory\corpus_index.json"
KEY_PATH        = r"C:\Xova\memory\corpus_signing_key.json"
RSA_PLUGIN      = r"C:\Xova\plugins\rsa_2048.py"

# Import rsa_2048 without pip — same technique used by mesh_runner
_rsa_dir = os.path.dirname(RSA_PLUGIN)
if _rsa_dir not in sys.path:
    sys.path.insert(0, _rsa_dir)
try:
    import rsa_2048 as _rsa
    _RSA_AVAILABLE = True
except Exception as _e:
    _RSA_AVAILABLE = False
    _RSA_IMPORT_ERROR = str(_e)


def _canonical(entry: dict) -> bytes:
    """Deterministic byte string over the identity fields of an entry."""
    payload = {
        "title":   entry.get("title") or entry.get("name") or "",
        "content": entry.get("content") or entry.get("excerpt") or "",
        "path":    entry.get("path") or "",
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")


def _key_fingerprint(kp: dict) -> str:
    """First 16 hex chars of SHA-256(n) — stable across re-runs."""
    n_hex = kp.get("n", "")
    return hashlib.sha256(n_hex.encode("utf-8")).hexdigest()[:16]


def _load_key() -> dict | None:
    if not os.path.exists(KEY_PATH):
        return None
    try:
        return json.load(open(KEY_PATH, encoding="utf-8"))
    except Exception:
        return None


def _save_key(kp: dict) -> None:
    tmp = KEY_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(kp, f, indent=2, ensure_ascii=False)
    os.replace(tmp, KEY_PATH)


def _load_corpus() -> list[dict]:
    data = json.load(open(CORPUS_PATH, encoding="utf-8"))
    return data if isinstance(data, list) else data.get("entries", [])


def _save_corpus(entries: list[dict]) -> None:
    tmp = CORPUS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, CORPUS_PATH)


def _is_manual(entry: dict) -> bool:
    """Manual entries have no root field (added by hand, not scanned from disk)."""
    return not entry.get("root")


def genkey() -> dict:
    """Generate a new RSA-2048 signing key and save it."""
    if not _RSA_AVAILABLE:
        raise RuntimeError(f"rsa_2048 not available: {_RSA_IMPORT_ERROR}")
    print("[corpus_signer] generating RSA-2048 key (~5-6s) …", flush=True)
    t0 = time.time()
    kp = _rsa.generate_keypair()
    fp = _key_fingerprint(kp)
    kp["_fingerprint"] = fp
    kp["_created"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _save_key(kp)
    print(f"[corpus_signer] key generated in {time.time()-t0:.1f}s · fingerprint {fp}")
    return kp


def sign(force: bool = False) -> dict:
    """Sign all unsigned manual corpus entries. Returns stats dict."""
    if not _RSA_AVAILABLE:
        return {"ok": False, "error": f"rsa_2048 not available: {_RSA_IMPORT_ERROR}"}

    kp = _load_key()
    if kp is None:
        print("[corpus_signer] no signing key found — generating one …")
        kp = genkey()

    fp = _key_fingerprint(kp)
    entries = _load_corpus()

    signed_now = 0
    already_signed = 0
    skipped = 0
    errors = 0

    t0 = time.time()
    for entry in entries:
        if not _is_manual(entry):
            skipped += 1
            continue
        if not force and entry.get("rsa_sig"):
            already_signed += 1
            continue
        try:
            canon = _canonical(entry)
            sig_bytes = _rsa.sign(canon, kp)
            entry["rsa_sig"]    = sig_bytes.hex()
            entry["rsa_key_fp"] = fp
            signed_now += 1
        except Exception as exc:
            entry["rsa_sig_error"] = str(exc)
            errors += 1

    _save_corpus(entries)
    elapsed = time.time() - t0
    stats = {
        "ok":           True,
        "signed_now":   signed_now,
        "already":      already_signed,
        "skipped_auto": skipped,
        "errors":       errors,
        "elapsed_s":    round(elapsed, 2),
        "key_fp":       fp,
    }
    print(
        f"[corpus_signer] sign: {signed_now} new · {already_signed} already · "
        f"{skipped} auto-scanned skipped · {errors} errors · {elapsed:.1f}s"
    )
    return stats


def verify() -> dict:
    """Verify all signed manual entries. Returns stats dict."""
    if not _RSA_AVAILABLE:
        return {"ok": False, "error": f"rsa_2048 not available: {_RSA_IMPORT_ERROR}"}

    kp = _load_key()
    if kp is None:
        return {"ok": False, "error": "no signing key — cannot verify"}

    entries = _load_corpus()
    passed = failed = unsigned = skipped = 0

    for entry in entries:
        if not _is_manual(entry):
            skipped += 1
            continue
        sig_hex = entry.get("rsa_sig")
        if not sig_hex:
            unsigned += 1
            continue
        try:
            canon = _canonical(entry)
            sig_bytes = bytes.fromhex(sig_hex)
            ok = _rsa.verify(canon, sig_bytes, kp)
            if ok:
                passed += 1
            else:
                failed += 1
                entry["_verify_fail"] = True
        except Exception as exc:
            failed += 1
            entry["_verify_error"] = str(exc)

    stats = {
        "ok":      failed == 0,
        "passed":  passed,
        "failed":  failed,
        "unsigned": unsigned,
        "skipped_auto": skipped,
    }
    verdict = "ALL PASS" if failed == 0 else f"{failed} FAILED"
    print(
        f"[corpus_signer] verify: {passed} pass · {failed} fail · "
        f"{unsigned} unsigned · {verdict}"
    )
    return stats


def status() -> dict:
    """Count signed/unsigned/auto-scanned entries without computing signatures."""
    entries = _load_corpus()
    manual_signed = manual_unsigned = auto_total = 0
    for e in entries:
        if _is_manual(e):
            if e.get("rsa_sig"):
                manual_signed += 1
            else:
                manual_unsigned += 1
        else:
            auto_total += 1
    kp = _load_key()
    fp = _key_fingerprint(kp) if kp else None
    stats = {
        "total":          len(entries),
        "manual_signed":  manual_signed,
        "manual_unsigned": manual_unsigned,
        "auto_scanned":   auto_total,
        "key_fp":         fp,
        "key_present":    kp is not None,
    }
    print(
        f"[corpus_signer] status: {manual_signed}/{manual_signed+manual_unsigned} "
        f"manual entries signed · key {'present' if kp else 'MISSING'}"
    )
    return stats


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Round 108: RSA-2048 corpus signing")
    parser.add_argument("cmd", choices=["sign", "verify", "status", "genkey"])
    parser.add_argument("--force", action="store_true", help="re-sign already-signed entries")
    args = parser.parse_args()

    if args.cmd == "genkey":
        genkey()
    elif args.cmd == "sign":
        sign(force=args.force)
    elif args.cmd == "verify":
        verify()
    elif args.cmd == "status":
        status()
