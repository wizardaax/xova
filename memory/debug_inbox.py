import json

HOOK_INBOX = r"C:\Xova\memory\forge_hook_inbox.jsonl"
INBOX_CURSOR = r"C:\Xova\memory\agent_runtime_cursors.json"

try:
    with open(INBOX_CURSOR, encoding="utf-8-sig") as f:
        cursors = json.load(f)
    print("cursors:", cursors)
except Exception as e:
    print("cursor read error:", e)
    cursors = {}

print("browser cursor:", cursors.get("browser", 0))

with open(HOOK_INBOX, "rb") as fh:
    for i, line in enumerate(fh):
        try:
            msg = json.loads(line)
            frm = msg.get("from", "")
            if "browser" in frm or "04" in frm:
                print(f"Line {i}: from={frm!r} content={msg.get('content','')[:60]!r}")
        except Exception as ex:
            print(f"Line {i}: parse error {ex}")
