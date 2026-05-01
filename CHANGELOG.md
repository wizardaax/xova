# Changelog

All notable changes to Xova are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/) · Versioning: [Semver](https://semver.org/).

## [Unreleased]

Nothing yet — next release lands here first.

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
