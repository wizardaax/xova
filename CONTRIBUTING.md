# Contributing to Xova

Thanks for the interest. Xova is a small project but I welcome bug reports, fixes, and ideas.

## Quick start

```pwsh
git clone https://github.com/wizardaax/xova
cd xova/app
npm ci
npm run tauri dev   # hot-reload dev mode
```

For production builds:

```pwsh
npm run tauri build
```

Outputs:
- `app/src-tauri/target/release/bundle/msi/Xova_<ver>_x64_en-US.msi`
- `app/src-tauri/target/release/bundle/nsis/Xova_<ver>_x64-setup.exe`

## Requirements

- **Windows 10/11 x64** (the only target right now — Tauri supports macOS/Linux but the build hasn't been verified there).
- **Node.js 20+** (the GitHub Actions runner uses 20).
- **Rust** stable toolchain (`rustup install stable`).
- **Visual Studio C++ Build Tools** (for the Tauri Rust crate to link).
- **Ollama** running locally with at least one chat model pulled (e.g. `ollama pull llama3.2:3b`).
- **(Optional) Jarvis daemon** — see the README for the file-bridge protocol.

## How to send a fix

1. **Open an issue first** for anything beyond a small typo. A two-sentence description is fine. I'd rather chat for 10 minutes about scope than reject a 200-line PR for going off in the wrong direction.
2. **Fork → branch → commit → push → PR.**
3. **Keep PRs focused.** One feature or one fix per PR. Smaller is easier to review.
4. **Don't reformat** unrelated code in a fix PR. Run `prettier`/`rustfmt` only on lines you touched.
5. **Local TypeScript must pass** — `npx tsc -b --noEmit` in `app/` should be silent.
6. **The CI workflow** (`.github/workflows/release.yml`) builds the installer on every tag — if a PR breaks the build, that workflow won't fire on you, but a future tag would. Test locally with `npm run tauri build`.

## Style

- **TypeScript** — Prettier defaults, single quotes are fine, semicolons.
- **Rust** — `cargo fmt` before committing.
- **Comments** — write the *why*, not the *what*. Code already says what; comments should say why a constraint exists, what surprised you, what bug led to a workaround.
- **No emojis in code or commits unless the surrounding code already has them.** The chat UI uses emoji intentionally; the build pipeline doesn't.

## Reporting bugs

Open an issue at https://github.com/wizardaax/xova/issues with:

- What you expected to happen
- What actually happened
- Your Windows version, Ollama version, and the loaded chat model
- The contents of `%TEMP%\xova-backup.log` if relevant

If the bug involves Jarvis (voice / TTS / speaker recognition), say so explicitly — Jarvis runs as a separate Python daemon and the failure mode is often there, not in Xova.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — please do **not** open a public issue for a security flaw.

## Code of conduct

Be reasonable. Disagree without being a jerk. If someone's pushback is sharper than you'd like, read it twice before you reply — it's almost always less personal than it reads in the first pass.

## Licence

By contributing you agree that your contribution is licensed under the MIT licence (the same as the rest of the repo).

— Adam Snellman
