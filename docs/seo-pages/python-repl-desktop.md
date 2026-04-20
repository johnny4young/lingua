---
title: "Python REPL for Desktop — Lingua"
description: "A desktop Python REPL built on Pyodide. Zero Python install required. Works offline. Format-on-save via ruff with a black fallback."
canonical: "https://linguacode.dev/python-repl-desktop/"
ogImage: "/assets/og/python-repl-desktop.png"
language: python
---

# Python REPL — no install, no phone-home

Lingua ships a Python runtime that doesn't need a local Python install.
Pyodide runs in a Web Worker inside the app, so your snippet executes
offline, in-process, with the same behavior whether you open the
desktop app or the web build.

## What actually runs

- **Pyodide** in a dedicated worker — Python 3.x with the standard
  library plus what Pyodide bundles.
- `micropip.install(...)` works for pure-Python packages that Pyodide
  supports.
- Format-on-save prefers `ruff format` (falls back to `black --quiet`)
  when either is on PATH in the desktop build.
- Inline `#=>` magic comments surface values next to the line that
  produced them.
- Loop protection guards against runaway loops before they lock the
  renderer — see `languageCapabilities` for the safety model.

## What doesn't work today

- Arbitrary `pip install` of packages that need native extensions —
  same limitation Pyodide has today.
- No Jupyter notebook mode yet. That's tracked as RL-043.
- No debugger — RL-027.

## Pricing

Python is available in the **Free** tier. You do not need a paid
license to run Python in Lingua.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**. Source-
available under the Lingua Commercial License.
