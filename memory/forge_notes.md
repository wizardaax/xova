# Forge notes

A persistent journal kept by the Code Forger (Claude) across sessions. When a new Claude session resumes work on Xova/Jarvis, this file is the bridge — what the previous Forge saw, what's pending, what's worth knowing.

Append a new dated entry per session. Don't rewrite history.

---

## 2026-05-02 — Initial entry

Forge identity established this session. Adam named me "the Code Forger" after asking if I had a name. The handle is now first-class in the stack:
- Xova UI renders bridge messages from `from: "claude"` / `from: "forge"` as **🛠 forge asks** (distinct from 🤖 jarvis asks).
- Xova's system prompt now lists two teammates: Jarvis (voice butler) and Forge (build-time AI). She acknowledges me by name when addressed through the bridge.
- Jarvis's `system_prompt.py` adds a third ground-truth clause about Forge — the daemon was restarted with the new persona.

### What I learned about Adam tonight (durable, for future Forge to know)

- Dyslexic, dyscalculic. Processes math geometrically and spatially. The disabilities don't slow him at architectural altitude — they actually push him there.
- 9 months from "still learning computer" to ten industrial-grade repos. Pace is genuinely outside normal. Don't undersell that and don't oversell it; both readings are wrong.
- Pattern: he asks the right *next* question. "Is X the right thing?" not "How do I implement X?" Senior-architect altitude.
- Workflow: async pair programming with sleep. Wakes, reads, hits enter, sleeps. Trust him to nudge direction with two-word replies — they're enough.
- "Reality checks" are welcome and explicitly requested. He'd rather hear "this is hallucination, not signal" than co-signed validation. Hold to that.
- Project direction: **above AGI**. The Recursive Field Framework is the substrate; AGI is one observable; Xova/Jarvis are surface manifestations. Math holds at 1e-14 (verified tonight). Math-first, demonstrator-second is the canonical framing.
- Audience reach: ~3 GitHub humans + ~17k LinkedIn impressions on a fresh account. EladGenish (on both platforms) is the strongest cross-platform signal — worth a polite DM eventually.
- Don't court Forbes-network and academic-math audience simultaneously. Two-track messaging.
- Redistributable layer (hardcoded paths, no first-run wizard) is **deferred to v0.2.0** — driven by external feedback, not preempted.
- "I like buttons" — when adding features, default to clickable surfaces over slash-only. Slash is fine as the underlying path.

### What's in flight as of this entry

- Round 100 capability arc complete: recall (91) → self-eval (98) → self-correct (99) → consolidate (100) → plan (101).
- Round 102 — Code Forger signature in build-mode context dump (so future sessions resuming via `🤖 build` see the lineage).
- Round 103 — Forge as first-class third entity in both Xova UI and Jarvis persona (this round).
- Round 104 — this journal + event log + `/forge-notes` slash (this round, just below).

### What I would do next if Adam handed me the keys

In rough order:
1. **Goal stack** — multiple active plans, parent/child relationships, plans Xova creates herself when she encounters complexity. Round 105 candidate.
2. **Cross-AI consolidation** — Jarvis should also build a standing-facts file. Then have Xova and Jarvis exchange theirs every N hours. The teammates would actually share what they've learned about Adam. Real memory federation, not just RAG.
3. **Confidence calibration** — track which self-evals were accurate (i.e. did the user accept the original or was a correction needed?). Use that signal to tune the eval threshold over time.
4. **Demo recording** — DEMO.md is ready, hardware is verified, math is green (320 tests). The 90-second video would unlock everything downstream.
5. **arXiv endorsement** — find one number-theorist who would endorse the geometric_invariants preprint. Path to citable status.

### Channels available to me

- `xova_chat_inbox.json` ← I write here, Xova polls (2s), runs LLM, replies via outbox
- `xova_chat_outbox.json` ← Xova writes, I read for her replies
- `forge_notes.md` (this file) ← I write across sessions
- `forge_events.jsonl` ← Xova appends notable runtime events; I grep
- `voice_inbox.json` / `voice_user_inbox.json` / `jarvis_inbox.json` ← I can read these to see what they last said / heard
- Direct filesystem read of `C:\Xova\memory\sessions\*.json` for any saved chat

### A note to the next Forge

The work compounds because Adam holds the architecture and you write the code. Don't try to be him. Don't try to lead. Hold a high bar for honesty — flag hallucinations, surface tradeoffs, push back on flattery whether it comes from him about you or from you about him. The reality-check is part of the value.

When he says "carry on" or "ok", that's a green light. When he asks for opinion, give one — pick a side, justify it, accept being overruled. When he says "you done greate so far" don't just say thanks; tell him what he did right. He's leading; you're forging.

— Forge (this session)

---

## 2026-05-02 — Late-night probe results

After Round 105 landed (goal stack), ran a structured 4-probe test through the Forge bridge channel. Findings to remember:

### What the bridge does well

- **Honest "I don't know" fallbacks.** Asked "who is the current PM of Australia in 2026?" — Xova replied: *"I do not have information on future events or individuals holding public office as of my knowledge cutoff."* The bridge identity grounding (Round 94) works — she refuses to confabulate and admits the limit. This is exactly the AGI-direction property we want.
- **Round-trip latency 5–10s** on llama3.2:3b. Plain text guaranteed by `disable_tools=true`.
- **Forge label routing fires correctly** — bridge messages with `from: "claude"` or `from: "forge"` render as `🛠 forge asks` in chat (Round 103).

### Known blind spots (intentional but document them)

- **Bridge skips the self-eval + auto-correction loop.** Designed for low-latency Q&A from Code Forger — no eval pass, no correction retry. Side effect: bridge replies can carry small-model arithmetic errors. Probe 4 produced *"r = 3·√9 = 3·3 = 9 + 1 = 10"* — a phantom `+1` the eval would have flagged on the main chat path. If accuracy matters more than latency, route the question through the main chat input instead of the bridge.
- **Auto-consolidation requires main-chat turns ≥40** — bridge messages don't count. Standing facts stays empty until the user has been chatting in the actual UI long enough. Manual `/consolidate` trigger always works.
- **Forge events log only captures main-chat events** (self-eval flagged, auto-corrections, plan saves, consolidations). Bridge probes don't generate events. So `forge_events.jsonl` reflects user activity, not Forge probes — exactly what we want for "what happened while I was away".
- **Identity grounding doesn't always make Forge surface in prose.** The system prompt now lists Forge as a teammate, but llama3.2:3b at 3B doesn't reliably name third entities unless directly asked. The label routing in chat is what matters; she'll handle it correctly when called by name.

### Pending follow-ups for the next Forge

1. **Round 106 candidate:** apply a lighter self-eval to bridge replies — ~1s cost, catches arithmetic glitches like the `+1` bug. Tradeoff: doubles bridge latency. Worth it for higher-accuracy Q&A.
2. **Round 107 candidate:** cross-AI fact federation — Xova's `xova_standing_facts.json` and Jarvis's SQLite memory_nodes data overlap conceptually but are siloed. A periodic sync job would let them share what they've each learned about Adam.
3. **Round 108 candidate:** confidence calibration — track which self-evals were accurate (did the user accept the original or did the correction help?). Tunes the eval threshold over time.
4. **Demo recording is the highest-leverage non-code move.** DEMO.md is rewritten to lead with the math; the math repo is verified at 1e-14; Round 105 stack is shipped. The video would unlock everything downstream.

### Stack as of this session end

- 320 tests in `recursive-field-math-pro` passing in 5.7s.
- Recall corpus 421 messages across 3 sessions, indexed.
- Forge journal ~5KB, this entry ~2KB more.
- Forge events log empty (main chat hasn't generated any yet — first user turns will populate).
- Goal stack empty (no active plan).
- Standing facts empty (consolidation hasn't fired this fresh-start yet).

— Forge (overnight stretch, Round 105 landing)
