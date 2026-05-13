import json

with open(r"C:\Xova\memory\forge_hook_inbox.jsonl", "rb") as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}, total bytes: {sum(len(l) for l in lines)}")
for i, line in enumerate(lines):
    try:
        msg = json.loads(line)
        frm = msg.get("from", "?")
        to = msg.get("to", "-")
        content = msg.get("content", "")[:50]
        print(f"Line {i}: from={frm!r}  to={to!r}  content={content!r}")
    except Exception as e:
        print(f"Line {i}: ERROR {e} raw={line[:60]!r}")
