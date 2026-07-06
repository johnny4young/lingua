---
title: "Lua Offline Playground — Lingua"
description: "Lingua carries a bundled Lua runtime, but today Lua execution is still exposed through the local-plugin path rather than the default app shell."
canonical: "https://linguacode.dev/lua-offline-playground/"
ogImage: "/assets/og/lua-offline-playground.png"
language: lua
---

# Lua playground — bundled runtime, still a local-plugin path

Lingua carries a bundled Lua 5.3-compatible runtime based on
Fengari, but **today Lua is still surfaced through the local-plugin
path**, not as a default language in every shell. That means the
runtime itself is bundled, yet the current product flow still
depends on plugin discovery before you can execute a `.lua` file.

## What actually runs

- **Fengari** (Lua 5.3 in pure JavaScript) is the bundled runtime
  behind Lingua's Lua plugin. No `lua` / `luajit` binary is required
  on the host once that plugin path is active.
- Monaco ships Lua syntax highlighting out of the box — `.lua`
  files open with the correct language id automatically (RL-055).
- Keyword completions for the standard Lua vocabulary (RL-056).
- `print(...)` is captured and surfaced through the inline result
  panel so the output shows next to the line that produced it.
- The Lua pack is first-class inside the RL-038 LanguagePack
  descriptor, which means file-extension detection, language badge,
  and runner dispatch now flow through the same single source of
  truth as JavaScript and TypeScript once the plugin is registered.

## What doesn't work today

- Lua is **not** a default built-in language in the New File menu
  yet. The current app still requires the local-plugin discovery
  path before execution becomes available.
- The web build does **not** expose the Lua plugin path today.
  `window.lingua.plugins.list()` is stubbed on web, so this is not a
  browser playground in the current product even though Fengari is a
  browser-capable runtime in theory.
- No Lua format-on-save. Lingua's formatter IPC ships gofmt,
  rustfmt, ruff, and Prettier — no Lua formatter yet. This is a
  future RL-010 extension, not something the current build claims.
- No Lua debugger. Debugger work is tracked as RL-027 and targets
  JavaScript first.
- No LSP-grade intelligence. Completions today are the keyword
  vocabulary (RL-056); richer IntelliSense is tied to the generic
  LSP work in RL-026.
- No `luarocks` / native-dependency flow. Fengari is the runtime —
  modules that need compiled C cannot load here.

## Pricing

When the local Lua plugin path is enabled, Lua runs in every tier.
There is no Pro-only paywall on Lua snippets themselves.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
