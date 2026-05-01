# Changelog

All notable changes to Xova are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [Semver](https://semver.org/).

## [Unreleased]

### Added (v0.1.1 candidate)

- **Browser-style slim toolbar** — quick-actions row dropped from 25 buttons to 6 essentials: `≡ menu`, `⌘ command`, `📎 upload`, `✂ snip`, `🖥 screen`, `🤖 build`, `🔇/🎙 jarvis`. Everything else lives in the Command Palette (Ctrl+K).
- **Keyboard shortcuts** — `Ctrl+K` toggle palette, `Ctrl+F` find-in-chat (pre-fills `/find`), `Ctrl+T` new session.
- **Visual life** — rotating thinking-rings on Xova/Jarvis silhouettes (counter-rotating, distinct rhythms), animated typing dots while streaming or summarising, soft radial gradient backdrop in chat area for depth.
- **Live recursive-field empty state** — when chat is blank, a 60-point φ-spiral (`r = 3·√n`, `θ = n·φ`) blooms in continuously. The same identity verified in `recursive-field-math-pro` at 1e-14, drawn live.
- **Cross-session memory** — recall index across all saved sessions, auto-injected into Xova's system prompt for relevant token-overlap matches; `/recall <q>` slash command for direct search.
- **`disable_tools` mode** for the bridge / banter / idle / summarize paths so the small model returns plain text instead of reflexive tool calls.
- **Bridge identity grounding** — sender-aware system prompt (Jarvis vs Claude) prevents the small model confabulating ("Jarvis is from Google", "I run on T5").
- **Recall threshold** — multi-token queries require ≥2 token overlap to match, preventing low-score noise injection into the system prompt.
- **Jarvis-side sanitizer** — strips fake `Xova:` impersonation blocks from Jarvis's voice-inbox replies before display.
- **Typo-tolerant Jarvis routing** — `jarivs`, `jarvi`, `jervis`, `javis`, `jarbis`, etc. now route directly to the real Jarvis daemon, matching the daemon's wake-aliases.
- **Empty-state starter prompts** — six clickable starter buttons appear when chat is blank (alongside the field visualisation).

### Changed

- **App icon** — chrome isometric cube wireframe replacing the default Tauri logo. Generated full size set (32px → 512px square logos + .ico + .icns + Android/iOS variants).
- **Jarvis silhouette** — Iron Man helmet → wireframe octahedron with luminous core. Removes the only trademark-adjacent visual anchor; pairs with Xova's arc reactor (circle/diamond geometric duality) and harmonizes with the cube app icon.
- **Status bar** — gradient backdrop, uppercase XOVA / JARVIS labels with accent colors, dot dividers; rotating dashed ring orbits silhouette when active.
- **Project positioning** — `wizardaax.github.io` reorganized into "Substrate" (Foundations / Papers / SCE-88 architecture, primary) and "Demonstrators" (Xova / Demo / Outreach, secondary). Math-first, above-AGI framing. `DEMO.md` rewritten to open on the math, not the chat. `OUTREACH.md` flipped lanes — math.SE / mathematicians primary, Show HN / r/LocalLLaMA tertiary.

### Fixed

- **`}}` JSX syntax error** in the palette `p-mute` item that strict TS would have flagged.
- **Dead state hooks** — `cameraOn` / `feedOn` / `phonesOn` / `memoryOn` setters that were no longer read anywhere; slash commands now correctly toggle the workspace dock instead.
- **Idle banter timer churn** — `messages` was in the deps array of the 30s interval, tearing it down + recreating on every new chat message. Switched to `messagesRef` so the interval is stable.
- **Idle banter speaking as Jarvis** — was misleading (no daemon, no TTS). Made idle banter Xova-only; she can mention Jarvis in her remark instead.
- **Empty sanitizer output** — when whole reply was a `🎙 Jarvis:` line, `stripImpersonation` returned empty. Now keeps the body, strips only the speaker label.
- **Generated audio in repo** — `plugins/codex_symphony.wav` (50.5 MB) was triggering GitHub's large-file warning on every push; now `.gitignore`d (rebuild via `python plugins/sound_wave.py`).
- **Token leak** — a `ghp_*` PAT was embedded in plain text in `.git/config` of one repo. Stripped, switched git globally to the Windows Credential Manager helper, token revoked at GitHub.

### Known limitations (deferred to v0.2.0)

- **Not yet redistributable for arbitrary users.** Hardcoded paths (`C:\Xova\memory\`, `C:\jarvis\src\`), Adam-specific identity in default prompts, no first-run wizard, no graceful degradation if Ollama or Jarvis is missing. Tagged for a v0.2.0 redistributable milestone — see GitHub issues / roadmap.
- **GPU `free` reading** is total system, not Ollama-attributed.
- **Recall search** is token-overlap, not embedding-based — adequate for "have we discussed X" but won't catch semantic paraphrases.
- **`/banter`** R3 closer fires after a fixed 8s wait; on slow Jarvis cold-load, the closer can land before his real reply.

---

## [0.1.0] — 2026-05-01

First public release. Tauri/React/Rust desktop AI agent paired with the Jarvis Python voice butler via JSON file bridges.

### Added

- **Chat** — local Ollama LLM (default `llama3.2:3b`) with markdown rendering, syntax-highlighted code blocks (`rehype-highlight` + GitHub-Dark theme), streaming output, date separators between days.
- **Voice in/out** — talk to Jarvis with a wake word; he replies via Piper/Chatterbox TTS. Wake word and aliases are configurable.
- **Speaker recognition** — Resemblyzer-based voice ID so Jarvis only listens to the enrolled user; the `🎓 enroll` button records 30 s of clean voice into a profile.
- **Vision** — full-screen and region-snip (`/region`, `/snip`) capture with automatic Ollama vision-model description.
- **Camera** — live camera tile with snapshot button (📸) that fires vision on the captured frame.
- **Cross-AI conversation** — `xova_ask_jarvis` from Xova → Jarvis; `askXova` Jarvis tool from Jarvis → Xova; `/banter [topic]` runs a real 3-round dialog through both bridges.
- **Status bar** — Iron Man helmet silhouette for Jarvis (gold, pulses on speak), arc reactor for Xova (emerald, pulses on think), Ollama health, GPU free MB, current loaded model.
- **Sessions** — `/sessions`, `/save-session`, `/load-session`, `/new-session`, plus a sessions strip with click-to-load pills.
- **Templates** — `/templates`, `/template <name>`, `/template-save`, `/template-delete`. Saved templates appear as `▸` buttons above the input.
- **Snippets / notes / pinned** — `/save`, `/snippets`, `/note`, `/notes`, `/pin`, `/pinned`, `/clear-pins`, `/clear-snippets`, `/clear-notes`. Pin and copy buttons on hover over any chat bubble.
- **Edit / delete chat bubbles** — ✎ on user messages pre-fills the input; × removes from chat. Hover-revealed.
- **Search & stats** — `/find <q>`, `/stats`, `/whoami`, `/who`, `/online`, `/redo`, `/again`, `/summarize [n]` (Ollama-summary of recent messages), `/version`, `/uptime`.
- **Quick launchers** — `/launch <url|app>`, `/edit <path>` (Notepad), `/cmd`, `/terminal`.
- **Build mode** — 🤖 button dumps last 60 messages to `last_context.md` and opens an admin terminal at the project root with `claude` ready to resume.
- **Mute / wake Jarvis** — `🔇 mute jarvis` / `🎙 wake jarvis` toggle in the action row that targets only the Jarvis daemon, not other Python processes.
- **Idle banter** — after 5 min of quiet, Xova makes one short observation about the time or recent chat. Toggle in `⚙ settings`.
- **Settings modal** — `⚙ settings` button opens a modal to switch Ollama model and `num_ctx` without editing JSON.
- **Command palette** — Ctrl+K opens a search-as-you-type list of every action (~35 entries grouped: Workspace / Vision / Capture / Sessions / Templates / Search / System / Help).
- **Slash autocomplete** — typing `/` in the input pops a popover; arrow keys / Tab / Esc.
- **Empty-state starter prompts** — six clickable starter buttons appear when chat is blank.
- **Memory bridges** — JSON-file two-way bridge between Xova and Jarvis at `C:\Xova\memory\`. Polled every 2 s with last-ts cursor protection.
- **Reverse UI bridge** — Jarvis can flip Xova's dock tabs (camera/feed/phones/memory) via `xova_command_inbox.json`.
- **Mesh dispatch** — `dispatchMesh()` and `cascadeMesh()` for routing tasks to the agent fleet (snell-vern, recursive-field-math-pro, etc.).
- **Backup script** — `backup_xova.ps1` mirrors local-only state to `D:\Xova-backups\<date>\` and to Google Drive (`G:\My Drive\Xova-backups\`); installs as a daily 3 AM scheduled task.

### Build & release

- MSI installer (3.04 MB) and NSIS installer (2.19 MB) attached to the v0.1.0 release on GitHub.
- GitHub Actions workflow (`.github/workflows/release.yml`): on `git push --tags` for any `v*` tag, builds installers on a Windows runner and attaches them to the matching release.

### Known issues

- Status-bar `gpu free` reading is from `nvidia-smi` and shows total free, not Ollama-attributed.
- `/banter` second leg (Xova → Jarvis) waits 8 s before the closer; if Jarvis is slow to load the model, the closer may fire before his reply lands.
- Idle banter and TTS speak the same recent context — if both fire close together they can overlap.

[Unreleased]: https://github.com/wizardaax/xova/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/wizardaax/xova/releases/tag/v0.1.0
