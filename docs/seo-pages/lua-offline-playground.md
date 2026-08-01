---
title: 'Lua Offline Playground — Lingua'
description: 'Lingua bundles a Lua 5.3-compatible Fengari runtime, but execution remains behind the desktop local-plugin path instead of the built-in language flow.'
canonical: 'https://linguacode.dev/lua-offline-playground'
ogImage: '/assets/og/lua-offline-playground.png'
language: lua
---

# Lua playground — a bundled runtime behind the local-plugin path

Lingua includes a Lua 5.3-compatible Fengari runtime, but Lua is not a
default built-in language today. Desktop execution becomes available
only after the local plugin-discovery path registers the bundled runner.

## What actually runs

- **Fengari** executes Lua in pure JavaScript, so the registered runner
  does not require a host `lua` or `luajit` binary.
- Monaco provides Lua syntax highlighting and keyword completion.
- `print(...)` output is captured and capped by the runner.
- Execution deadlines stop unbounded Lua loops from freezing the app.
- Once registered, extension detection, language badges, and runner
  dispatch use the same language-pack descriptor shape as built-in
  runners.

## What doesn't work today

- Lua is not a default option in the New File menu. The desktop plugin
  discovery path must register it first.
- The web build does not expose local plugin discovery, so this is not
  a web Lua playground today.
- There is no Lua format-on-save, debugger, LSP-grade intelligence,
  standard-input bridge, or rich-output bridge.
- There is no `luarocks` installation flow, and native C modules cannot
  load through Fengari.

## Pricing

When the local Lua plugin path is active, Lua execution is not gated to
a paid tier.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
