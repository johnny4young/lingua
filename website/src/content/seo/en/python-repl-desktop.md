---
title: 'Python REPL for Desktop — Lingua'
description: 'Run Python offline with Pyodide, inline results, notebooks, rich output, micropip packages, and desktop formatting through ruff or black.'
canonical: 'https://linguacode.dev/python-repl-desktop'
ogImage: '/assets/og/python-repl-desktop.png'
language: python
---

# Python REPL — no local Python installation required

Lingua runs Python through Pyodide in a dedicated Worker. Your snippet
stays local and behaves consistently in the desktop and web builds,
while notebooks provide a persistent scope when one-off execution is
not enough.

## What actually runs

- **Pyodide** provides Python 3 and its bundled standard library without
  requiring a host Python installation.
- `micropip` installs compatible pure-Python and Pyodide-supported
  wheels into the active browser session.
- Inline `#=>` comments, standard input, rich tables, charts, images,
  and HTML output use the same result surface as the other runners.
- Python notebook cells share variables inside one notebook, remain
  isolated from other notebooks, and import or export Jupyter
  `.ipynb` and native `.linguanb` files.
- On desktop, format-on-save prefers `ruff format` and falls back to
  `black` when either tool is available on `PATH`.
- Desktop Debug uses host CPython/pdb with gutter breakpoints, stepping,
  locals, a source-local call stack, and watches. Project `.venv` or `venv`
  takes precedence when available.
- Execution deadlines and output caps keep runaway code from taking
  over the application shell.

## What doesn't work today

- Packages that require unsupported native extensions cannot be
  installed through `micropip`.
- Lingua does not create or persist a local Python virtual environment.
  Desktop execution still uses Pyodide rather than host CPython.
- Python debugging is desktop-only. Watches run inside the local debug process
  and may have side effects; conditional breakpoints and logpoints remain
  JavaScript/TypeScript-only.

## Pricing

Python execution is available in the **Free** tier. Paid plans add
unlimited tabs and snippets, notebook access, and the broader Pro
toolset.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
