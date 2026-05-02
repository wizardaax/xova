# Xova Trash — Append-Only Recycle Bin

This dir is **never emptied**. Every file Xova would otherwise delete goes here
with timestamp + SHA-256 + reason. The ledger at `index.jsonl` lets her search
for and restore anything she lost.

## Principle

True-AGI accountability: no agent gets to delete its own past silently.
Everything that disappears from a working location persists here forever, with
provenance:
- when (UTC ISO timestamp)
- who (acting agent)
- why (reason string)
- from where (original path)

## Layout

```
trash/
├── README.md            (this file)
├── index.jsonl          (append-only ledger; one JSON record per line)
├── 20260502_120000_<sha>_<name>/
│   └── <name>           (frozen copy of the file at deposit time)
└── ...
```

## Ledger schema (one line per deposit)

```json
{
  "id":        "20260502_120000_a1b2c3d4e5f6",
  "ts":        "20260502_120000",
  "agent":     "xova",
  "actor":     "forge | xova | jarvis | user",
  "reason":    "freeform string — why this deposit happened",
  "src_path":  "C:\\Xova\\app\\src\\App.tsx",
  "stored_at": "C:\\Xova\\trash\\20260502_120000_a1b2c3d4e5f6_App.tsx\\App.tsx",
  "size":      182108,
  "sha256":    "a1b2c3d4e5f6...",
  "name":      "App.tsx"
}
```

## CLI usage (any agent or human)

```
python D:\temp\trash_keeper.py deposit xova "C:\path\to\file" "reason" "actor"
python D:\temp\trash_keeper.py search  xova "App.tsx"
python D:\temp\trash_keeper.py list    xova
python D:\temp\trash_keeper.py restore xova <id> "C:\target\path"
```

## In-app slash (live in Xova chat)

```
/trash               → list 20 most recent deposits
/trash <query>       → search by name/path/reason
/trash-restore <id>  → restore an entry to its original path
```

## NEVER EMPTY

- NTFS deny-delete on this dir + every entry
- Drive mirror at `G:\My Drive\agent-trash\xova\`
- Memory-vault snapshots include this dir (cumulative offsite history)
- Approved cleanup requires explicit user directive AND a snapshot before reset

If this rule is broken, the breach itself goes into the Forge ledger, dated.
