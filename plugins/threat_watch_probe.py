"""threat_watch_probe.py — local security probe, stdlib only.

Checks: network connections, running processes, Windows auth events, memory file anomalies.
Returns a single JSON line: {ok, level, rule_version, threats, watches, checks, scan_ms, ts}
"""
import json, os, subprocess, time
from datetime import datetime, timezone, timedelta

RULE_VERSION = "1.3"

SAFE_LISTEN_PORTS = {
    5174, 5173, 5175, 3000, 8080, 8443,       # dev servers / Vite HMR
    11434, 11435,                              # Ollama
    135, 139, 445, 1080,                       # Windows system / SMB / NetBIOS
    5040,                                      # Windows UWP / DPS
    5357, 5358,                                # WSD (Web Services on Devices)
    2179,                                      # Hyper-V remote desktop
    7680,                                      # Windows Update Delivery Optimization
    49664, 49665, 49666, 49667, 49668, 49669,  # Windows ephemeral RPC
}
LOCAL_NETS = ("127.", "::1", "0.0.0.0", "[::]", "192.168.", "10.", "172.16.", "172.17.", "172.18.")
SAFE_FOREIGN_PORTS = {80, 443, 5174, 11434, 8080, 8443, 5228, 5229}  # 5228/5229 = Google push

SUSPICIOUS_PROCS = [
    "xmrig", "xmr-stak", "miner", "coinhive",
    "mimikatz", "wce.exe", "pwdump",
    "nc.exe", "ncat.exe", "netcat",
    "psexec", "psexesvc",
    "nmap.exe", "masscan", "zmap",
    "svchosts.exe", "lsasss.exe",          # common Windows process name spoofs
]


def _run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           creationflags=0x08000000)
        return r.stdout
    except Exception:
        return ""


def check_network():
    threats, watches = [], []
    out = _run(["netstat", "-ano"])
    unusual_listen, ext_conns, close_wait = [], [], 0

    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        # netstat -ano columns: Proto  Local  Foreign  State  PID  (TCP)
        #                  or:  Proto  Local  Foreign  PID         (UDP)
        proto  = parts[0].upper() if parts else ""
        local  = parts[1] if len(parts) > 1 else ""
        foreign = parts[2] if len(parts) > 2 else ""
        state  = parts[3] if len(parts) > 3 else ""
        pid    = parts[4] if len(parts) > 4 else parts[-1]

        if state in ("LISTENING", "LISTEN"):
            if ":" in local:
                port_str = local.rsplit(":", 1)[-1]
                laddr    = local.rsplit(":", 1)[0].strip("[]")
                try:
                    port = int(port_str)
                    # Only flag non-loopback, non-ephemeral, unexpected ports
                    if port not in SAFE_LISTEN_PORTS and port < 49152 and laddr not in ("127.0.0.1", "::1", "[::1]"):
                        unusual_listen.append(f":{port}")
                except ValueError:
                    pass

        elif state == "ESTABLISHED" and ":" in foreign:
            faddr = foreign.rsplit(":", 1)[0].strip("[]")
            fport_str = foreign.rsplit(":", 1)[-1]
            if not any(faddr.startswith(p) for p in LOCAL_NETS) and faddr not in ("", "0.0.0.0"):
                try:
                    fport = int(fport_str)
                    if fport not in SAFE_FOREIGN_PORTS:
                        ext_conns.append(f"{faddr}:{fport_str}")
                except ValueError:
                    pass

        elif state == "CLOSE_WAIT":
            close_wait += 1

    if unusual_listen:
        watches.append(f"Unexpected listener(s): {', '.join(unusual_listen[:4])}")
    if ext_conns:
        watches.append(f"External connection(s): {', '.join(ext_conns[:3])}")
    if close_wait > 40:
        watches.append(f"High CLOSE_WAIT ({close_wait}) — possible connection leak or scan")

    return threats, watches, {
        "unusual_listeners": len(unusual_listen),
        "external_conns": len(ext_conns),
        "close_wait": close_wait,
    }


def check_processes():
    threats = []
    flagged = []
    out = _run(["tasklist", "/FO", "CSV", "/NH"])
    count = sum(1 for l in out.splitlines() if l.strip())
    for line in out.splitlines():
        if not line.strip():
            continue
        name = line.split(",")[0].strip('"').lower()
        for s in SUSPICIOUS_PROCS:
            if s in name:
                flagged.append(name)
                break
    if flagged:
        threats.append(f"Suspicious process: {', '.join(sorted(set(flagged)))}")
    return threats, {"checked": count, "flagged": len(flagged)}


def check_auth():
    """Check Windows Security log for recent failed logins (event 4625)."""
    threats = []
    failed = 0
    try:
        out = _run([
            "powershell", "-NoProfile", "-NonInteractive", "-Command",
            "Get-WinEvent -FilterHashtable @{LogName='Security';Id=4625} "
            "-MaxEvents 30 -ErrorAction SilentlyContinue | "
            "Select-Object -ExpandProperty TimeCreated | "
            "ForEach-Object { $_.ToUniversalTime().ToString('o') }"
        ], timeout=8)
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
        for ts_str in out.strip().splitlines():
            ts_str = ts_str.strip()
            if not ts_str:
                continue
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt > cutoff:
                    failed += 1
            except Exception:
                pass
        if failed >= 3:
            threats.append(f"{failed} failed login attempt(s) in last 10 min")
    except Exception:
        pass
    return threats, {"failed_logins_10m": failed}


def check_files():
    """Watch for bulk unexpected changes to Xova memory files."""
    watches = []
    now = time.time()
    mem_dir = r"C:\Xova\memory"
    recent = []
    if os.path.isdir(mem_dir):
        try:
            for fname in os.listdir(mem_dir):
                fp = os.path.join(mem_dir, fname)
                if os.path.isfile(fp) and (now - os.path.getmtime(fp)) < 60:
                    recent.append(fname)
        except Exception:
            pass
    if len(recent) > 10:
        watches.append(f"Bulk memory write: {len(recent)} files changed in 60s")
    return watches, {"recently_modified_60s": len(recent)}


def main():
    t0 = time.time()

    net_t, net_w, net_s = check_network()
    proc_t, proc_s       = check_processes()
    auth_t, auth_s       = check_auth()
    file_w, file_s       = check_files()

    threats = net_t + proc_t + auth_t
    watches = net_w + file_w

    level = "clear"
    if watches:
        level = "watch"
    if threats:
        level = "alert"

    print(json.dumps({
        "ok": True,
        "level": level,
        "rule_version": RULE_VERSION,
        "threats": threats,
        "watches": watches,
        "checks": {
            "network":   {"ok": not net_t and not net_w, **net_s},
            "processes": {"ok": not proc_t, **proc_s},
            "auth":      {"ok": not auth_t, **auth_s},
            "files":     {"ok": True, **file_s},
        },
        "scan_ms": round((time.time() - t0) * 1000),
        "ts": time.time(),
    }, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
