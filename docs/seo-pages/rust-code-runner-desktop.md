---
title: 'Rust Code Runner for Desktop — Lingua'
description: 'Run and debug Rust locally with rustc, lldb-dap, rust-analyzer intelligence, rustfmt, compile markers, dependency assistance, and Cargo project tests.'
canonical: 'https://linguacode.dev/rust-code-runner-desktop'
ogImage: '/assets/og/rust-code-runner-desktop.png'
language: rust
---

# Rust code runner — a local scratchpad with real compiler feedback

Lingua compiles the current Rust file with your installed `rustc`, runs
the native result, and maps compiler feedback into the editor. It is a
fast place to isolate an idea without pretending to replace a complete
Cargo workspace.

## What actually runs

- `rustc` compiles the current file as Rust 2021 and Lingua executes the
  native binary without invoking a shell.
- Compile errors become Monaco markers with source locations; stdout,
  stderr, and panics stream into the result panel.
- `rust-analyzer` provides desktop diagnostics, completions, hover, and
  signature help when the binary is available.
- `rustfmt` handles format-on-save for `.rs` files.
- Debug mode compiles the current buffer with debug symbols and drives local
  `lldb-dap` for pause breakpoints, stepping, locals, call stack, and watches.
- Inline `//=>` comments work like the JavaScript and TypeScript
  scratchpad markers.
- In a saved project with `Cargo.toml`, the dependency panel can run a
  confirmed `cargo add`, and the project test runner can execute
  `cargo test --color never`.

## What doesn't work today

- Rust execution requires `rustc` on the desktop. The web build reports
  the desktop-only boundary.
- Language intelligence requires a local `rust-analyzer` binary.
  Settings provides detection, installation guidance, and restart
  controls.
- Rust debugging is desktop-only and requires `lldb-dap`. Lingua discovers the
  Xcode adapter through `xcrun` on macOS or uses the binary on `PATH` elsewhere.
  It debugs the current buffer, not a complete Cargo workspace.
- The scratchpad runner compiles one file with `rustc`; it does not run
  a complete Cargo application. Use project tests or the integrated
  terminal for workspace-level commands.

## Why this is in the paid tier

Rust execution is a paid-tier feature. Education access provides the
same entitlements free for verified students and educators.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
