---
title: 'Go Playground for Desktop — Lingua'
description: 'Run and debug Go locally with go build, Delve, gopls, gofmt, inline errors, dependency help, and project tests in an offline-first desktop app.'
canonical: 'https://linguacode.dev/go-playground-desktop'
ogImage: '/assets/og/go-playground-desktop.png'
language: go
---

# Go playground — use the toolchain already on your desktop

Lingua runs Go locally instead of uploading source to a shared
playground. The current file compiles through your Go installation,
while desktop project tools add gopls intelligence, dependency
assistance, tests, search, and a terminal around an approved folder.

## What actually runs

- `go build` compiles the current file to WebAssembly with
  `GOOS=js GOARCH=wasm`; the result executes in a Worker inside the app.
- Compile errors become Monaco markers with source locations.
- `gopls` provides diagnostics, completions, hover, and signature help
  on desktop when the binary is available.
- `gofmt` handles format-on-save for `.go` files.
- Inline `//=>` comments surface values beside the line that produced
  them.
- In a saved project with `go.mod`, the dependency panel can run a
  confirmed `go get`, and the project test runner can execute
  `go test ./...`.
- Debug mode drives local Delve through DAP for pause breakpoints,
  step over/into/out, locals, source-local call stack, and watches.

## What doesn't work today

- Go execution requires a local Go installation. The web build reports
  the desktop-only boundary instead of pretending to run it.
- gopls intelligence requires a local `gopls` binary. Settings provides
  detection, installation guidance, and restart controls when it is
  missing or stops.
- Go debugging requires a local `dlv` binary. Install it with
  `go install github.com/go-delve/delve/cmd/dlv@latest`; macOS also
  requires Developer Tools access for the current account.
- Debug mode runs the current buffer in a temporary single-file module;
  it does not yet debug an entire saved module or imported local files.
- The scratchpad runner compiles the current file; it does not replace
  a full `go run` workflow or manage your module proxy and cache.

## Why this is in the paid tier

Go execution is a paid-tier feature. Education access provides the same
entitlements free for verified students and educators.

## Download

Get Lingua at **[https://linguacode.dev](https://linguacode.dev)**.
Source-available under the Lingua Commercial License.
