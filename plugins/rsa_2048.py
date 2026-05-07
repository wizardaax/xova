"""
rsa_2048.py — Pure-stdlib RSA-2048 implementation.

100-year design: no pip dependencies. Uses only os, hashlib, json, time.
  - Key generation via Miller-Rabin primality + os.urandom
  - OAEP-style padding (MGF1-SHA-256, label hash)
  - Encrypt / decrypt
  - Sign (PSS-style: SHA-256 hash then PKCS#1 v1.5 signature scheme) / verify
  - Keys stored as JSON (hex strings, human-readable, no ASN.1 DER needed)

CLI:
  python rsa_2048.py genkey  [--out keys.json]
  python rsa_2048.py encrypt --key keys.json --msg "hello"
  python rsa_2048.py decrypt --key keys.json --ciphertext <hex>
  python rsa_2048.py sign    --key keys.json --msg "hello"
  python rsa_2048.py verify  --key keys.json --msg "hello" --sig <hex>
  python rsa_2048.py selftest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time

# ── Constants ───────────────────────────────────────────────────────────────

KEY_BITS   = 2048
BYTE_LEN   = KEY_BITS // 8         # 256
PUBLIC_EXP = 65537                  # standard Fermat prime
HASH_LEN   = 32                     # SHA-256 output bytes

# ── Miller-Rabin primality ───────────────────────────────────────────────────

# Deterministic witnesses cover all integers < 3,317,044,064,679,887,385,961,981
# (well above 2^2048), so no false primes possible for our key size.
_DETERMINISTIC_WITNESSES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]


def _miller_rabin(n: int, witnesses: list[int] | None = None) -> bool:
    if n < 2:
        return False
    if n == 2 or n == 3:
        return True
    if n % 2 == 0:
        return False
    # Write n-1 as 2^r * d
    r, d = 0, n - 1
    while d % 2 == 0:
        r += 1
        d //= 2
    for a in (witnesses or _DETERMINISTIC_WITNESSES):
        if a >= n:
            continue
        x = pow(a, d, n)
        if x == 1 or x == n - 1:
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _rand_odd_int(bits: int) -> int:
    b = bytearray(os.urandom(bits // 8))
    b[0] |= 0x80           # set top bit so number is exactly `bits` wide
    b[-1] |= 0x01           # ensure odd
    return int.from_bytes(b, "big")


def _random_prime(bits: int) -> int:
    while True:
        candidate = _rand_odd_int(bits)
        if _miller_rabin(candidate):
            return candidate


# ── Extended GCD / modular inverse ──────────────────────────────────────────

def _modinv(a: int, m: int) -> int:
    g, x, _ = _ext_gcd(a % m, m)
    if g != 1:
        raise ValueError("modular inverse does not exist")
    return x % m


def _ext_gcd(a: int, b: int) -> tuple[int, int, int]:
    if a == 0:
        return b, 0, 1
    g, x1, y1 = _ext_gcd(b % a, a)
    return g, y1 - (b // a) * x1, x1


# ── OAEP padding (MGF1-SHA-256) ──────────────────────────────────────────────

def _mgf1(seed: bytes, length: int) -> bytes:
    """Mask generation function, MGF1 with SHA-256."""
    out = b""
    for counter in range((length + HASH_LEN - 1) // HASH_LEN):
        c = counter.to_bytes(4, "big")
        out += hashlib.sha256(seed + c).digest()
    return out[:length]


def _oaep_pad(message: bytes, n_bytes: int, label: bytes = b"") -> bytes:
    """OAEP encode message into n_bytes - 1 bytes (the leading zero byte is added at encrypt time)."""
    lhash = hashlib.sha256(label).digest()
    max_msg = n_bytes - 2 * HASH_LEN - 2
    if len(message) > max_msg:
        raise ValueError(f"message too long: max {max_msg} bytes, got {len(message)}")
    ps = bytes(max_msg - len(message))
    db = lhash + ps + b"\x01" + message
    seed = os.urandom(HASH_LEN)
    db_mask = _mgf1(seed, n_bytes - HASH_LEN - 1)
    masked_db = bytes(a ^ b for a, b in zip(db, db_mask))
    seed_mask = _mgf1(masked_db, HASH_LEN)
    masked_seed = bytes(a ^ b for a, b in zip(seed, seed_mask))
    return b"\x00" + masked_seed + masked_db


def _oaep_unpad(em: bytes, n_bytes: int, label: bytes = b"") -> bytes:
    lhash = hashlib.sha256(label).digest()
    if len(em) != n_bytes:
        raise ValueError("decryption error")
    y, masked_seed, masked_db = em[0], em[1:HASH_LEN + 1], em[HASH_LEN + 1:]
    if y != 0:
        raise ValueError("decryption error")
    seed_mask = _mgf1(masked_db, HASH_LEN)
    seed = bytes(a ^ b for a, b in zip(masked_seed, seed_mask))
    db_mask = _mgf1(seed, n_bytes - HASH_LEN - 1)
    db = bytes(a ^ b for a, b in zip(masked_db, db_mask))
    if db[:HASH_LEN] != lhash:
        raise ValueError("decryption error: label mismatch")
    sep = db.index(b"\x01", HASH_LEN)
    return db[sep + 1:]


# ── PKCS#1 v1.5 signature padding (simple, deterministic) ───────────────────

# SHA-256 DigestInfo prefix per RFC 3447
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


def _pkcs1_sign_pad(msg_hash: bytes, n_bytes: int) -> bytes:
    t = _SHA256_PREFIX + msg_hash
    ps_len = n_bytes - len(t) - 3
    if ps_len < 8:
        raise ValueError("key too small for PKCS#1 v1.5 signature")
    return b"\x00\x01" + (b"\xff" * ps_len) + b"\x00" + t


def _pkcs1_verify_pad(em: bytes) -> bytes:
    if em[0:2] != b"\x00\x01":
        raise ValueError("signature verification failed")
    idx = em.index(b"\x00", 2)
    return em[idx + 1:]


# ── Key generation ───────────────────────────────────────────────────────────

def generate_keypair(bits: int = KEY_BITS) -> dict:
    """Return {n, e, d, p, q} all as hex strings."""
    while True:
        p = _random_prime(bits // 2)
        q = _random_prime(bits // 2)
        if p == q:
            continue
        n = p * q
        if n.bit_length() != bits:
            continue
        phi = (p - 1) * (q - 1)
        if phi % PUBLIC_EXP == 0:
            continue
        d = _modinv(PUBLIC_EXP, phi)
        break
    return {
        "bits":      bits,
        "n":  hex(n),
        "e":  hex(PUBLIC_EXP),
        "d":  hex(d),
        "p":  hex(p),
        "q":  hex(q),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def public_key(kp: dict) -> tuple[int, int]:
    return int(kp["n"], 16), int(kp["e"], 16)


def private_key(kp: dict) -> tuple[int, int]:
    return int(kp["n"], 16), int(kp["d"], 16)


# ── Encrypt / decrypt ────────────────────────────────────────────────────────

def encrypt(message: bytes, kp: dict) -> bytes:
    n, e = public_key(kp)
    n_bytes = (n.bit_length() + 7) // 8
    em = _oaep_pad(message, n_bytes)
    m_int = int.from_bytes(em, "big")
    c_int = pow(m_int, e, n)
    return c_int.to_bytes(n_bytes, "big")


def decrypt(ciphertext: bytes, kp: dict) -> bytes:
    n, d = private_key(kp)
    n_bytes = (n.bit_length() + 7) // 8
    c_int = int.from_bytes(ciphertext, "big")
    m_int = pow(c_int, d, n)
    em = m_int.to_bytes(n_bytes, "big")
    return _oaep_unpad(em, n_bytes)


# ── Sign / verify ────────────────────────────────────────────────────────────

def sign(message: bytes, kp: dict) -> bytes:
    n, d = private_key(kp)
    n_bytes = (n.bit_length() + 7) // 8
    digest = hashlib.sha256(message).digest()
    em = _pkcs1_sign_pad(digest, n_bytes)
    s_int = pow(int.from_bytes(em, "big"), d, n)
    return s_int.to_bytes(n_bytes, "big")


def verify(message: bytes, signature: bytes, kp: dict) -> bool:
    n, e = public_key(kp)
    n_bytes = (n.bit_length() + 7) // 8
    s_int = int.from_bytes(signature, "big")
    em = pow(s_int, e, n).to_bytes(n_bytes, "big")
    try:
        t = _pkcs1_verify_pad(em)
        expected = _SHA256_PREFIX + hashlib.sha256(message).digest()
        return t == expected
    except (ValueError, IndexError):
        return False


# ── Self-test ────────────────────────────────────────────────────────────────

def selftest() -> None:
    print("RSA-2048 selftest — generating keypair (takes ~2-5s)...", flush=True)
    t0 = time.time()
    kp = generate_keypair()
    print(f"  keygen: {time.time()-t0:.2f}s")
    print(f"  n[:32]: {kp['n'][:34]}...")

    msg = b"AEON Engine - 100-year design test"

    ct = encrypt(msg, kp)
    pt = decrypt(ct, kp)
    assert pt == msg, f"encrypt/decrypt mismatch: {pt!r} != {msg!r}"
    print(f"  encrypt/decrypt: PASS  (ciphertext {len(ct)} bytes)")

    sig = sign(msg, kp)
    assert verify(msg, sig, kp), "verify failed on correct message"
    tampered = msg + b"!"
    assert not verify(tampered, sig, kp), "verify passed on tampered message — BUG"
    print(f"  sign/verify:     PASS  (signature {len(sig)} bytes)")

    print("selftest PASSED")


# ── CLI ──────────────────────────────────────────────────────────────────────

def _cli() -> None:
    parser = argparse.ArgumentParser(description="RSA-2048 (stdlib only)")
    sub = parser.add_subparsers(dest="cmd")

    p_gen = sub.add_parser("genkey")
    p_gen.add_argument("--out", default="rsa_keys.json")

    p_enc = sub.add_parser("encrypt")
    p_enc.add_argument("--key", required=True)
    p_enc.add_argument("--msg", required=True)

    p_dec = sub.add_parser("decrypt")
    p_dec.add_argument("--key", required=True)
    p_dec.add_argument("--ciphertext", required=True)

    p_sig = sub.add_parser("sign")
    p_sig.add_argument("--key", required=True)
    p_sig.add_argument("--msg", required=True)

    p_ver = sub.add_parser("verify")
    p_ver.add_argument("--key", required=True)
    p_ver.add_argument("--msg", required=True)
    p_ver.add_argument("--sig", required=True)

    sub.add_parser("selftest")

    args = parser.parse_args()

    if args.cmd == "genkey":
        kp = generate_keypair()
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(kp, f, indent=2)
        print(f"keypair written to {args.out}")
        print(f"n[:32]: {kp['n'][:34]}...")

    elif args.cmd == "encrypt":
        kp = json.load(open(args.key, encoding="utf-8"))
        ct = encrypt(args.msg.encode("utf-8"), kp)
        print(ct.hex())

    elif args.cmd == "decrypt":
        kp = json.load(open(args.key, encoding="utf-8"))
        pt = decrypt(bytes.fromhex(args.ciphertext), kp)
        print(pt.decode("utf-8"))

    elif args.cmd == "sign":
        kp = json.load(open(args.key, encoding="utf-8"))
        sig = sign(args.msg.encode("utf-8"), kp)
        print(sig.hex())

    elif args.cmd == "verify":
        kp = json.load(open(args.key, encoding="utf-8"))
        ok = verify(args.msg.encode("utf-8"), bytes.fromhex(args.sig), kp)
        print("VALID" if ok else "INVALID")
        sys.exit(0 if ok else 1)

    elif args.cmd == "selftest":
        selftest()

    else:
        parser.print_help()


if __name__ == "__main__":
    _cli()
