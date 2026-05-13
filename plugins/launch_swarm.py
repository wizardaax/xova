"""Launch all 13 agent_runtime daemons in background. Run once; each daemon loops at 120s."""
import subprocess, sys, os, time, json

RUNTIME = r"C:\Xova\plugins\agent_runtime.py"
AGENTS  = ["forge","jarvis","mesh","browser","corpus","evolution",
           "sentinel","phase","field","memory","repo","voice","coherence"]
INTERVAL = 120  # seconds between cycles — long enough to not hammer Ollama
NO_WIN  = 0x08000000

pids = {}
for i, agent in enumerate(AGENTS):
    p = subprocess.Popen(
        [sys.executable, "-u", RUNTIME, "--agent", agent,
         "--interval", str(INTERVAL),
         "--start-delay", str(i * 3)],  # stagger starts by 3s each
        creationflags=NO_WIN,
        stdout=open(fr"C:\Xova\memory\agent_{agent}.log", "a", encoding="utf-8"),
        stderr=subprocess.STDOUT,
    )
    pids[agent] = p.pid
    print(f"  {agent:12s} pid={p.pid}")

print(json.dumps({"ok": True, "launched": len(pids), "pids": pids}, indent=2))
