---
title: 'Multi-Language Code Runner — Lingua'
description: 'Run JavaScript, TypeScript, Python, Ruby, Go, and Rust in one offline-first desktop app with notebooks, HTTP/SQL workspaces, and project tools.'
canonical: 'https://linguacode.dev/multi-language-code-runner'
ogImage: '/assets/og/multi-language-code-runner.png'
language: multi
---

# Multi-language code runner — six built-in runners, one desktop app

Lingua brings scratchpad execution, project navigation, notebooks, and
developer workspaces into one Monaco-powered application. Each language
keeps an honest runtime boundary instead of being forced through the
same remote sandbox.

## What actually runs

| Language   | Runtime                                                    | Free tier? |
| ---------- | ---------------------------------------------------------- | ---------- |
| JavaScript | Worker, desktop Node, or Browser preview                   | Yes        |
| TypeScript | esbuild-wasm plus Worker, desktop Node, or Browser preview | Yes        |
| Python     | Pyodide in a Worker                                        | Yes        |
| Ruby       | Ruby WASM on web or host Ruby on desktop                   | Yes        |
| Go         | Local `go build` to WASM, then Worker execution            | Paid       |
| Rust       | Local `rustc` to a native subprocess                       | Paid       |

Shared workflows include:

- Monaco editing, fuzzy Quick Open, project search, replace-in-files,
  symbol navigation, and Git status or diffs on desktop.
- Inline results, standard input where supported, rich console output,
  execution history, JS/TS debugging in both shells, and standard Python
  debugging on desktop.
- TypeScript, Python, and SQL notebook cells with Jupyter import/export.
- HTTP request and DuckDB-powered SQL workspaces.
- Prettier, gofmt, rustfmt, ruff or black format-on-save paths.
- Desktop dependency assistance for npm, Go, Rust, and Ruby projects,
  plus a project test runner for Vitest, Jest, Pytest, Go, and Cargo.

## What doesn't work today

- Go and Rust execution requires local desktop toolchains. Web reports
  those runners as unavailable.
- Python and web Ruby use WASM runtimes, so unsupported native packages
  remain outside their package model.
- Step debugging is available for JavaScript and TypeScript in both shells and
  for Python, Go, and Rust on desktop. Ruby does not have a step debugger; Go
  requires local Delve and Rust requires local `lldb-dap`.
- gopls and rust-analyzer intelligence is desktop-only and requires the
  corresponding local binary.
- Lua remains behind a local plugin-discovery path rather than the
  default built-in language flow.

## Pricing

Free includes the JavaScript, TypeScript, Python, and Ruby runners,
three open tabs, and five saved snippets. Paid plans add unlimited tabs
and snippets, Go and Rust, notebooks, execution history, and the broader
Pro toolset.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
