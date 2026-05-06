"""
probe_base.py — Shared harness for file-tailing probes.

Subclass ProbeBase and override filter() and transform().
Everything else — cursor tracking, atomic writes, error logging,
singleton guard, poll loop — is handled here once.

Stdlib only: json, os, subprocess, sys, time.
"""
from __future__ import annotations
import json, os, subprocess, sys, time


class ProbeBase:
    def __init__(self, name: str, source_path: str, interval: float,
                 emit_path: str, cursor_path: str,
                 log_path: str | None = None, log_cap: int = 200) -> None:
        self.name        = name
        self.source_path = source_path
        self.interval    = interval
        self.emit_path   = emit_path
        self.cursor_path = cursor_path
        self.log_path    = log_path or os.path.join(os.path.dirname(emit_path), f"{name}.log")
        self.log_cap     = log_cap

    def filter(self, line: dict) -> bool:   # noqa: A003
        return True

    def transform(self, line: dict) -> dict:
        return line

    def _already_running(self) -> bool:
        try:
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-Command",
                 "Get-CimInstance Win32_Process "
                 "-Filter \"name='pythonw.exe' OR name='python.exe'\" "
                 "| Select-Object -ExpandProperty CommandLine"],
                capture_output=True, text=True, timeout=10, creationflags=0x08000000,
            )
            return len([l for l in result.stdout.splitlines() if self.name in l]) > 1
        except Exception:
            return False

    def _log(self, msg: str) -> None:
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} [{self.name}] {msg}"
        try: print(line)
        except Exception: pass
        try:
            os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
            try:
                with open(self.log_path, "r", encoding="utf-8") as fh:
                    prior = fh.readlines()
            except FileNotFoundError:
                prior = []
            kept = prior[-(self.log_cap - 1):] if len(prior) >= self.log_cap else prior
            kept.append(line + "\n")
            with open(self.log_path, "w", encoding="utf-8") as fh:
                fh.writelines(kept)
        except Exception:
            pass

    def _read_cursor(self) -> int:
        try:
            with open(self.cursor_path, encoding="utf-8") as fh:
                return int(json.load(fh).get("pos", 0))
        except Exception:
            return 0

    def _write_cursor(self, pos: int) -> None:
        os.makedirs(os.path.dirname(self.cursor_path), exist_ok=True)
        tmp = self.cursor_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump({"pos": pos, "updated_at": time.time()}, fh, ensure_ascii=False)
        os.replace(tmp, self.cursor_path)

    def _read_new(self, cursor: int) -> tuple[list[dict], int]:
        try:
            with open(self.source_path, "r", encoding="utf-8", errors="replace") as fh:
                fh.seek(cursor)
                raw     = fh.read()
                new_pos = fh.tell()
        except FileNotFoundError:
            return [], cursor
        except Exception as exc:
            self._log(f"read failed: {exc}")
            return [], cursor
        parsed = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    parsed.append(obj)
            except Exception:
                pass
        return parsed, new_pos

    def _emit(self, items: list[dict]) -> None:
        if not items:
            return
        try:
            os.makedirs(os.path.dirname(self.emit_path), exist_ok=True)
            try:
                with open(self.emit_path, "r", encoding="utf-8") as fh:
                    existing = fh.read()
            except FileNotFoundError:
                existing = ""
            lines = existing + "".join(json.dumps(i, ensure_ascii=False) + "\n" for i in items)
            tmp = self.emit_path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(lines)
            os.replace(tmp, self.emit_path)
        except Exception as exc:
            self._log(f"emit failed: {exc}")

    def _cycle(self) -> None:
        cursor = self._read_cursor()
        lines, new_pos = self._read_new(cursor)
        if not lines:
            return
        passing = [self.transform(l) for l in lines if self.filter(l)]
        self._emit(passing)
        self._write_cursor(new_pos)
        self._log(f"{len(lines)} lines read, {len(passing)} passed filter")

    def run(self) -> None:
        if self._already_running():
            sys.exit(0)
        self._log("started")
        while True:
            try:
                self._cycle()
            except Exception as exc:
                self._log(f"cycle error: {exc}")
            time.sleep(self.interval)
