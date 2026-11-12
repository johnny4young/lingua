# ADR — Desktop stack review (November 2026)

| Status   | Accepted                                                                                  |
| -------- | ----------------------------------------------------------------------------------------- |
| Decision | Lingua stays on Electron. Effort goes into startup, memory, CPU and build time inside it. |
| Date     | 2026-11-05                                                                                |

## Context

The maintainer reviewed the stack of every app, comparing Electron and
SwiftUI with Go (Fyne, Wails) and Rust (Tauri, GPUI). The same small app was
built in all six and measured on Apple Silicon, and Lingua's production
libraries were audited against each ecosystem.

Moving from Electron to a system webview shell (Tauri, Wails) saved bundle
size, not memory or startup. GPUI was the only clear efficiency gain, and it
means rewriting the whole UI. Nothing was measured on Windows, on Linux or in
Lingua itself.

## Decision

Keep Electron, Vite and electron-builder (`BUILD_SYSTEM_ADR.md`). Improve
Lingua inside that stack: workers, WASM and native modules where they pay off.
`TAURI_SPIKE_ADR.md` and its revisit triggers stay in force.

## Consequences

- No shell migration starts without a successor ADR.
- If GPUI is ever adopted, the license rule in `AGENTS.md` applies.
- The measurements and library audit are in the maintainer's private research
  report, not in this repository.
