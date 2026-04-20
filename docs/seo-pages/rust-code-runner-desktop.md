---
title: "Rust Code Runner for Desktop — Lingua"
description: "Run Rust on your local rustc toolchain from a Monaco editor. rustfmt on save. Real compile errors. Offline. Source-available."
canonical: "https://linguacode.dev/rust-code-runner-desktop/"
ogImage: "/assets/og/rust-code-runner-desktop.png"
language: rust
---

# Rust Code Runner — native rustc, native errors

Lingua shells out to your installed `rustc`, compiles your snippet,
runs the resulting binary, and surfaces compile errors as Monaco
markers. It's a desktop scratchpad, not a remote sandbox — which means
your full crate ecosystem works because the compiler is yours.

## What actually runs

- `rustc` compiles your file to a native binary; Lingua spawns it and
  captures stdout + stderr into the inline result panel.
- Rust compile errors normalize into Monaco markers with source
  locations — no stderr blob dumps.
- `rustfmt` is the default format-on-save handler for `.rs` files.
- Panics stream into the result panel mapped back to the source line.
- Inline `//=>` magic comments work the same way they do for the JS
  and TS runners.

## What doesn't work today

- You need `rustc` on PATH. The web build surfaces Rust execution as
  "desktop only" instead of pretending it works.
- No rust-analyzer integration yet — only Monaco's keyword
  completion. LSP work is tracked as RL-026.
- No debugger yet — RL-027.
- No cargo project mode: this is a scratchpad for single-file
  snippets, not a substitute for `cargo run` inside your workspace.

## Why this is in the paid tier

Rust execution unlocks with a Pro license. The Free tier runs
JavaScript, TypeScript, and Python only.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**. Source-
available commercial license, education access free for verified
students and teachers.
