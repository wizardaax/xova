"""rff_score.py — score recent mesh coherence via RFF eval_api, return JSON to stdout."""
import json, math, os, sys, time

_PHI = (1.0 + math.sqrt(5.0)) / 2.0  # golden ratio ≈ 1.618

MESH_FEED    = r"C:\Xova\memory\mesh_feed.jsonl"
BOARD_PATH   = r"C:\Xova\memory\agent_board.json"
RFF_SRC      = r"D:\github\wizardaax\recursive-field-math-pro\src"


def _phi_weighted_mean(values: list[float]) -> float:
    """Exponential φ-weighted mean — newer values weighted by φ^k."""
    if not values:
        return 0.0
    weights = [_PHI ** i for i in range(len(values))]
    total   = sum(weights)
    return sum(w * v for w, v in zip(weights, values)) / total


def _phi_entropy(values: list[float]) -> float:
    """Normalised Shannon entropy of φ-discretised values (bins of 1/φ width)."""
    if len(values) < 2:
        return 0.0
    bin_w = 1.0 / _PHI
    counts: dict[int, int] = {}
    for v in values:
        b = int(max(0.0, min(0.9999, v)) / bin_w)
        counts[b] = counts.get(b, 0) + 1
    n = len(values)
    entropy = -sum((c / n) * math.log2(c / n) for c in counts.values() if c > 0)
    max_e = math.log2(max(1, len(counts)))
    return round(entropy / max_e, 4) if max_e > 0 else 0.0


def _read_last_coherences(n: int = 50) -> list[float]:
    values: list[float] = []
    try:
        with open(MESH_FEED, "r", encoding="utf-8") as fh:
            lines = fh.readlines()
        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj.get("coherence"), (int, float)):
                    values.append(float(obj["coherence"]))
                    if len(values) >= n:
                        break
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return list(reversed(values))


def _read_cycles() -> int:
    try:
        with open(BOARD_PATH, "r", encoding="utf-8") as fh:
            board = json.load(fh)
        return int(board.get("absorb", {}).get("cycles", 0))
    except Exception:
        return 0


def main() -> None:
    values = _read_last_coherences(50)
    cycles = _read_cycles()
    n = len(values)

    rff_ok = False
    coherence = entropy = confidence = 0.0

    if n > 0:
        # Try real RFF eval_api
        try:
            sys.path.insert(0, RFF_SRC)
            from recursive_field_math.eval_api import score  # type: ignore
            result = score(values, mode="numeric")
            if result.get("ok"):
                coherence   = float(result.get("coherence",   0))
                entropy     = float(result.get("entropy",     0))
                confidence  = float(result.get("confidence",  0))
                rff_ok = True
        except Exception:
            pass

        if not rff_ok:
            coherence  = _phi_weighted_mean(values)
            entropy    = _phi_entropy(values)
            confidence = min(1.0, n / 50.0) * (1.0 / _PHI)

    print(json.dumps({
        "ok":         True,
        "coherence":  round(coherence,  4),
        "entropy":    round(entropy,    4),
        "confidence": round(confidence, 4),
        "n":          n,
        "cycles":     cycles,
        "rff_ok":     rff_ok,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import json as _j; print(_j.dumps({"ok": False, "error": str(e)}))
