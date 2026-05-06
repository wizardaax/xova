"""rff_score.py — score recent mesh coherence via RFF eval_api, return JSON to stdout."""
import json, os, sys

MESH_FEED    = r"C:\Xova\memory\mesh_feed.jsonl"
BOARD_PATH   = r"C:\Xova\memory\agent_board.json"
RFF_SRC      = r"D:\github\wizardaax\recursive-field-math-pro\src"


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
            coherence  = sum(values) / n
            entropy    = 1.0 - coherence
            confidence = min(1.0, n / 50.0) * 0.5

    print(json.dumps({
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
