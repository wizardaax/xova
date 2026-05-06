# MASTER_TODO.md — Xova / Jarvis / Forge / Absorb ecosystem
# Single source of truth. Read this at the start of every session.
# Cross off completed items. Bank new ideas here before they get lost.
# Last updated: 2026-05-07

---

## Session 2026-05-07 — Agent Audit Sweep

Fixed 35 bugs across Xova, Jarvis, and Snell-Vern in one autonomous agent session.

**Main categories:**
- **Forge bridge data integrity:** forge_outbox converted from last-write-wins to append-log (AUDIT-2-004); BOM stripped from forge_inbox.json, xova_slash_inbox.json, PID_*.json
- **Voice routing:** `_last_forge_voice_ts` wired correctly into `_route_voice_to_forge` (AUDIT-2-006)
- **UI / bubble fixes:** queued forge bubble in-place update on reply landed (AUDIT-2-014); bubble ID collision fixed with random suffix (AUDIT-2-017); reply prefill word-boundary cut at 80 chars (AUDIT-2-018)
- **Watchdog stability:** 30-second age guard prevents killing newly started forge_listener (AUDIT-2-020)
- **Log hygiene:** forge_listener log rotation confirmed (AUDIT-2-002); role-prefix strip confirmed (AUDIT-2-025)
- **Dead code removed:** CommandCenter.tsx, TopologyView.tsx, ThreeWayChat.tsx removed from bundle
- **Heartbeats:** Xova watchdog and Jarvis daemon both now write agent_board heartbeats

---

## DONE (2026-05-05 — verified working)

- **Absorb-loop hardening — all five items, dry-run verified:**
  - Item 1: Singleton guard patched to catch `python.exe OR pythonw.exe`
  - Item 2: Orphan absorb_loop processes killed (PIDs 16016, 4076 cleared before verification run)
  - Item 3B: Deterministic grounding check — rule-based, zero latency, survives model swap
  - Item 4: Vocabulary filter — strips prose fields before Ollama digest; FUTURE WORK block documented
  - Item 5: Two-strikes corroboration with `TWO_STRIKE_WINDOW=3` — state persisted to `absorb_state.json`
  - `absorb_state.json` verified written: `{"forge_events": {"last_sig": 5, "last_cycle": 1}, ...}`
  - `absorb_log.jsonl` entries confirmed with `last_sig`, `two_strike`, `recent` fields
  - `trash_keeper.py` patched: `"absorb"` agent → `C:\Xova\trash-absorb`

- **Forge bridge — fully wired and tested (2026-05-04):**
  - forge_listener.py routes forge_inbox → claude --print → forge_outbox → voice_inbox
  - Rate limiter 20/hr, queue mode, startup drain, rate log persistence all live
  - Jarvis `askForge` tool registered in registry.py
  - xova_watchdog.py manages forge_listener lifecycle

- **AUDIT-2-002** FIXED — forge_listener log rotation confirmed active; unbounded-growth risk closed
- **AUDIT-2-003** FIXED — startup drain added to forge_listener.py
- **AUDIT-2-004** FIXED — forge_outbox converted from single-entry last-write-wins to append-log; concurrent replies no longer silently lost
- **AUDIT-2-005** FIXED — rate limit timestamps persisted to forge_rate_log.json
- **AUDIT-2-006** FIXED — `_last_forge_voice_ts` now wired in `_route_voice_to_forge`; clock-drift skipping closed
- **AUDIT-2-014** FIXED — queued forge bubble updates in-place when reply lands; "(queued)" no longer stale
- **AUDIT-2-017** FIXED — bubble ID collision closed; random suffix added to `forge-reply-${ts}`
- **AUDIT-2-018** FIXED — reply prefill word-boundary cut at 80 chars (was hard 60-char mid-word cut)
- **AUDIT-2-020** FIXED — watchdog 30s age guard added; newly started forge_listener no longer killed on first tick
- **AUDIT-2-025** FIXED — "Forge:"/"Jarvis:" role-label prefix strip confirmed in output path
- **BOM files stripped** — forge_inbox.json, xova_slash_inbox.json, PID_*.json all UTF-8 clean
- **Dead components removed** — CommandCenter.tsx, TopologyView.tsx, ThreeWayChat.tsx removed from bundle
- **agent_board heartbeats** — Xova watchdog + Jarvis daemon both write heartbeats; `alive` fields no longer stale false

- **`target_new\xova.exe` deployed** — DONE 2026-05-05 ~03:37 AEST.
  Shipped in one binary: CRIT-1 filesystem sandbox + CRIT-2 command allowlist
  (commit 1228574 on master) + CRITICAL NEW-1 Rust cancellation token fix
  (branch fix/critical-new-1-ollama-cancel). Build: 0 warnings, 47s incremental.
  Binary: 24,985,088 bytes, deployed to `target\debug\xova.exe`, Xova relaunched.

---

## NEXT UP (in order)

1. **Wire absorb_loop into xova_watchdog.py**
   - Add `ABSORB_SCRIPT = r"C:\Xova\absorb_loop.py"`
   - Add `_start_absorb()` function (same pattern as `_start_forge_listener`)
   - In `main()` xova-alive branch: `if not absorb_pids: _start_absorb()`
   - In xova-exit branch: kill absorb_pids
   - Launches as `pythonw.exe` (matches forge_listener / mesh_runner pattern). Singleton guard's OR filter catches both `pythonw.exe` and `python.exe` interactive runs.

2. **App.tsx absorb-role bubble** — role="absorb" currently falls through to green
   Jarvis bubble. Add `isAbsorbBubble = role === "absorb"` check in the
   voice_inbox polling block (App.tsx ~lines 781-810). Give it own emoji/colour.

3. ~~**AUDIT-2-025** — Ban "Forge:"/"Jarvis:" prefixes from llama output.~~
   **DONE 2026-05-07** — post-processing strip confirmed in output path.

4. ~~**Heartbeats for Xova/Jarvis in agent_board.json**~~ **DONE 2026-05-07** —
   Xova watchdog + Jarvis daemon both now write heartbeats; `alive` fields accurate.

---

## AUDIT-2 PASS PENDING (from AUDIT_2026-05-04_pass2.md)

Resolved 003, 005 (previous session). Resolved 002, 004, 006, 014, 017, 018, 020, 025 (2026-05-07 audit sweep).
Open findings below — pull full descriptions from `C:\Xova\AUDIT_2026-05-04_pass2.md`.

| ID | Severity | Status | One-line description |
|----|----------|--------|----------------------|
| AUDIT-2-002 | HIGH | **DONE 2026-05-07** | forge_listener log not rotated — grows unbounded, will fill disk |
| AUDIT-2-003 | MEDIUM | **DONE** | startup drain added to forge_listener.py |
| AUDIT-2-004 | HIGH | **DONE 2026-05-07** | forge_outbox is single-entry last-write-wins — concurrent replies silently lost |
| AUDIT-2-005 | MEDIUM | **DONE** | rate limit timestamps persisted to forge_rate_log.json |
| AUDIT-2-006 | MEDIUM | **DONE 2026-05-07** | `_route_voice_to_forge` advances `_last_voice_ts` unconditionally — clock drift can skip forge-bound messages |
| AUDIT-2-007 | MEDIUM | OPEN | No retry on claude subprocess failure — failed messages discarded permanently |
| AUDIT-2-011 | HIGH | OPEN | ask_forge.py visibility in Jarvis tool loader unverified — `__init__.py` may not export it |
| AUDIT-2-012 | MEDIUM | OPEN | ask_forge timeout (150s) may exceed Jarvis LLM call timeout — user sees Jarvis error not graceful wait |
| AUDIT-2-013 | LOW | OPEN | Jarvis→Forge voice path not yet tested end-to-end ("jarvis ask forge X" live test pending) |
| AUDIT-2-014 | MEDIUM | **DONE 2026-05-07** | Queued forge message has no reply-landed signal — "(queued)" bubble never updates when reply arrives |
| AUDIT-2-016 | LOW | OPEN | "ask forge" regex doesn't handle colon separator — "ask forge: X" doesn't match |
| AUDIT-2-017 | LOW | **DONE 2026-05-07** | forge bubble id may collide on same-millisecond replies — `forge-reply-${ts}` not unique enough |
| AUDIT-2-018 | LOW | **DONE 2026-05-07** | Reply button prefill cuts mid-word at hard 60-char boundary |
| AUDIT-2-019 | LOW | OPEN | Multiple mesh_runner instances can accumulate — standardise absolute path in `_start_mesh()` |
| AUDIT-2-020 | LOW | **DONE 2026-05-07** | Watchdog kills forge_listener without checking process age — newly started listener can be killed |
| AUDIT-2-021 | LOW | OPEN | Feed tab uses 🔒 emoji — suggests security not feeds; change to 📡 or 🗂 |
| AUDIT-2-022 | LOW | OPEN | /enroll has no UI button — per RULE 8 slash commands need a button surface |
| AUDIT-2-023 | LOW | OPEN | Watchdog has no auto-reload — edits to xova_watchdog.py require manual watchdog restart to take effect |
| AUDIT-2-024 | LOW | OPEN | forge_listener resets `_last_inbox_ts` to 0 on startup — last forge_inbox.json message reprocessed as duplicate on every restart |
| AUDIT-2-025 | MEDIUM | **DONE 2026-05-07** | Ban "Forge:"/"Jarvis:" prefixes from llama output — 3B model adds role-label prefixes that bleed into UI |

---

## NEXT MAJOR BUILDS (architectural, not housekeeping)

- **Help bubble system** — ? icons next to controls; what/how/why panels explaining
  each control in plain language. Apprentice's computer design test.

- **Live action trace panel** — plain English real-time narration of what Xova is
  doing as she does it (tool calls, eval cycles, memory ops).

- **Replay button on every completed action** — re-run any prior action with current
  context.

- **Depth toggle** — explain it like I'm 12 / 16 / dev / show me code. User-selectable
  explanation register applied to all Xova output.

- **Why panel on every result** — every answer includes an expandable "why" section
  showing the reasoning chain.

- **Plain-language errors through substrate translation** — all error messages routed
  through a translator that produces human prose, not stack traces.

- **Device control gateway** — Jarvis drives TV/devices via Bluetooth/HDMI-CEC/Wi-Fi
  protocols. Combination mode: protocol-driven for digital steps + voice-coaching for
  physical steps.

- **Combination mode** — protocol-driven for digital steps + voice-coaching for
  physical steps + depth-toggled educational mode. Background absorb-loop accumulates
  context; foreground actions are fast and tailored because of it.

---

## ABSORB-LOOP FUTURE WORK
### (verbatim from `absorb_loop.py` FUTURE WORK comment block, lines ~252-286)
### Trigger: (a) loop has run in real operation for 1+ week and actual failure modes
### are on record, OR (b) the larger model lands on new hardware.

1. **Positional/tabular digest format.** Less prose-shaped, less vocabulary leakage.
   E.g. "[self-eval | risk=1 | agent=09]" or true tabular columns. Removes JSON
   syntax cues that small models treat as prose structure.

2. **Pre-annotated anomaly hints.** Pre-compute which values are unusual
   (risk=5 [HIGH], coherence=0.18 [LOW]) before sending to the model. Moves anomaly
   detection from model judgment into deterministic preprocessing — model only has to
   synthesise, not detect.

3. **Batching by agent_id.** Group lines per-agent before sending. Gives model
   coherent per-agent context instead of a mixed smear of 13 agents.

4. **Diff against baseline.** Pre-compute rolling averages per source (mean coherence
   over last 100 cycles) and send current-vs-baseline deltas. Makes the significance
   question sharper and less dependent on the model having an implicit baseline.

5. **Per-agent rolling state.** Track recent significance history per agent_id, not
   just per source. "agent_13 flagged 3 times in the last hour" is much stronger
   signal than a single-shot eval.

6. **Schema-aware extraction.** Different sources (forge_events, mesh_feed, future
   sources) have different field shapes. Per-source filter configs instead of one
   global `_DIGEST_KEEP_FIELDS`.

---

## REPO FEDERATION (13 active wizardaax repos)

**Confirmed 9:**
- recursive-field-math-pro
- SCE-88
- ziltrix-sch-core
- Snell-Vern-Hybrid-Drive-Matrix
- recursive-field-math
- glyph_phase_engine
- Codex-AEON-Resonator
- wizardaax.github.io
- aeon-standards

**4 newer (Adam to confirm names):** AGI, Sentinel + 2 more

**Possible additional repo splits to consider:**
- provenance/audit-chain
- hardware-spec
- bridge-gateway reference implementation (agent_gateway.py when server arrives)
- findings/publications
- threat-model/red-team
- tooling

---

## OPERATING CONTEXT (standing)

- **Server build** (R7525 / dual EPYC 7003) — saving toward. When online: revive
  `agent_gateway.py` sketch from forge_notes.md (generalised forge_listener with
  pluggable executors: claude / ollama / local). Lucy + Baymax personas.
- **LinkedIn / DSTG / NVIDIA** — visibility tracking ongoing. DSTG auto-reply routed
  to ASCA Nov 2025; no follow-up yet. Don't publish AEON/DSTG correspondence without
  Adam's go-ahead.
- **Bayesian cross-domain paper** on wizardaax.github.io — in parallel.
- **Voynich pipeline and other research threads** — in parallel.
- **Elad Genish (RNSE)** — independent validator, detected same n=150 phase transition
  autonomously. Keep the relationship warm.

---

## DESIGN PRINCIPLES (apply to everything)

- **Tool is everyone's friend** — the design test. If the control is confusing to
  someone who has never seen it, add a ? bubble. No expert-only surfaces.

- **Apprentice's computer** — show the work, grow the user. Every action narrated.
  Every result explained. Every error translated. Depth toggle always available.

- **ECU substrate** — substrate stateless to operator affect (REQ-01); style absorption
  is a boundary integrity vulnerability (REQ-02). Adam's automotive background: safety
  as structural impossibility, not behavioural alignment.

- **Defensive habits survive model swaps** — grounding check, two-strikes, threshold
  gates are all deterministic. They don't depend on the 3B model being correct. Any
  model plugged in gets the same safety margin.

- **Foreground + Background** — foreground is combination mode (protocol drives +
  voice coaches + depth-toggled education). Background is absorb-loop accumulating
  context. Both required. Background makes foreground fast and tailored.

- **Local-first, audit-everything, fail-safe defaults, reversible via trash_keeper,
  no forced upgrades.** 100-year design contract: stdlib only, no SaaS, no API keys,
  no pip-installable deps. Write the 20 lines yourself instead.

- **AEON IS the goal** — the 13-agent fleet exists to make AEON Engine iterable by
  one human + autonomous fleet. When prioritising: AEON-blocking work goes first.

---

## NEW FINDINGS — 5 May 2026 audit

**~~CRITICAL — NEW-1: Orphaned Rust Ollama call~~ — FIXED 2026-05-05 ~03:37 AEST**
  Branch: fix/critical-new-1-ollama-cancel.
  Fix: CancellationToken in Tauri managed state (CancelMap); tokio::select! races
  stream.next() vs cancel signal; JS calls cancel_ollama_stream before rejecting on
  180s timeout. Stream drop closes TCP → Ollama stops inference.
  Also ships in same binary: CRIT-1 filesystem sandbox (path_allowed()) + CRIT-2
  command allowlist (command_allowed()) — commit 1228574 on master.
  Original bug: Promise.race() — JS rejected after 180s but Rust call ran
  indefinitely, blocking all subsequent Ollama requests. Live evidence: 01:30–02:18
  hang, only cleared by killing Ollama runner PID 660.

**CRITICAL — NEW-5: Ollama saturation, no coordination**
  Files: `C:\Xova\absorb_loop.py:154`, `C:\Xova\app\src\lib\mesh.ts:130`,
  Jarvis voice intent path
  Bug: Three independent clients hit `localhost:11434/api/generate`
  with no lock, no queue, no backoff. Ollama serves one request at
  a time. Overlap = indefinite queue for losers.
  Fix path: substrate-side serializer — file lock or HTTP gateway
  in xova_watchdog.py with FIFO queue. Or per-client backoff when
  `/api/tags` shows runner busy.

**HIGH — NEW-2: absorb_loop Ollama timeout may not fire**
  File: `C:\Xova\absorb_loop.py:154`
  Bug: socket timeout resets per byte; Ollama can stall mid-inference
  with timeout never firing. Tonight's evidence: 30+ min stuck without
  90s timeout triggering.
  Fix path: wall-clock timeout via `threading.Timer`, or stream API
  with chunk timeout.

**LOW — NEW-4: Watchdog singleton guard not updated**
  File: `C:\Xova\xova_watchdog.py:25`
  Bug: only queries `name='pythonw.exe'` — should match
  `absorb_loop.py:34` pattern of `pythonw.exe OR python.exe`.

---

## CORRECTED DIAGNOSIS — Python312 ghost

The "duplicate Jarvis on Python312" pattern that's hit twice is NOT a
bug. `C:\jarvis\.venv` was built on `C:\Python312`, so the venv stub
(`C:\jarvis\.venv\Scripts\pythonw.exe`) is a thin Windows launcher that
spawns the actual interpreter (`C:\Python312\pythonw.exe`) as a child.
The "two Jarvis processes" is one Jarvis daemon split across launcher +
worker by Windows venv design. Earlier May 3 fix to `_start_jarvis()`
kill-existing-before-spawn is still useful for crash recovery but the
two-PID pattern is not pathological.

Same pattern applies to Ollama: `ollama serve` (small, ~120 MB) spawns
`ollama runner --model <sha256> --port <N>` as a child when a model is
loaded. Two ollama PIDs = one server. Not a duplicate, not an orphan.

**⚠ May 3 watchdog kill-before-spawn patch** — fixed a non-bug. The
trigger was the two-PID Jarvis pattern being misread as a duplicate
daemon. The patch is harmless (30s cooldown + query-ok guard are
genuinely useful for crash recovery) but the root hunt was a
misdiagnosis. Do not re-open.

---

## KNOWN LIMITATIONS — not bugs, don't flag as regressions

### GTX 1650 4 GB VRAM — model eviction latency
- `llama3.2:3b` (~2 GB VRAM) is Xova's chat model.
- `gemma4:latest` is Jarvis's vision model (larger, runs CPU-offloaded).
- When Jarvis loads gemma4, llama3.2:3b may be evicted from VRAM.
- Next Xova chat message pays cold-load penalty: ~7.2s Ollama reload
  + ~8s Xova processing = ~16s first-reply latency.
- Hot path (model already loaded): ~2.7s.
- `keep_alive: "1h"` is set in Xova's ollama_chat command but VRAM
  pressure from Jarvis can evict regardless. Hardware constraint, not a
  code bug. Audit probes must allow ≥35s for cold-load scenarios.

---

## RULES QUICK-REFERENCE (full rules in CLAUDE.md)

- NEVER REBUILD — no `cargo build`, `npm run tauri build`, no compile steps without
  per-build approval. All new features frontend-only (App.tsx + Vite HMR).
- NEVER DELETE — deposit to trash first, then ask, then proceed only if approved.
- NEVER RESTART without PID listed + explicit per-instance approval.
- NEVER PROPOSE RESTART as Option A or fallback.
- COMPRESSION-SAFE — update `project_session_state.md` every ~10 min; new rules to
  `feedback_<topic>.md` immediately; back up memory + chat JSONL every ~10 min.
