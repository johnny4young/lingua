---
title: Getting started
description: Install Lingua, run your first snippet in five languages, and find the keyboard shortcuts that make it fast.
order: 1
section: guide
---

Lingua is a desktop-first multi-language code runner. Install it once and you have JavaScript, TypeScript, Python, Go, and Rust ready to go in a single Monaco-powered window.

## Install

Head to [linguacode.dev/releases](/releases) and grab the build for your platform. Every release ships:

- macOS — Apple-signed and notarized `.zip` for arm64 and x64.
- Windows — Authenticode-signed `.exe` installer.
- Linux — `.deb` and `.rpm` packages for x86_64 and aarch64.

Verify the download against `SHA256SUMS.txt` if you want a paranoid double-check:

```sh
shasum -a 256 -c SHA256SUMS.txt
```

## Your first snippet

Open Lingua. The editor opens on a fresh JavaScript tab. Try this:

```js
const stars = await fetch('https://api.github.com/repos/johnny4young/lingua')
  .then((r) => r.json())
  .then((j) => j.stargazers_count);
console.log(`stars: ${stars}`);
```

Hit `Cmd/Ctrl+Enter`. The result panel updates inline.

## Switch language

Open the language menu in the tab strip (or `Cmd/Ctrl+L`) and pick another language. Your tab is replaced with a real, runnable starter snippet for that language. JavaScript, TypeScript, and Python work on every install — they're shipped runtimes inside Lingua.

Go and Rust delegate to the toolchains you already have on your machine. If `go version` or `rustc --version` works in your terminal, Lingua will pick them up automatically.

## Keep it fast

A handful of shortcuts that make Lingua disappear:

- `Cmd/Ctrl+P` — quick-open snippet
- `Cmd/Ctrl+Shift+P` — command palette
- `Cmd/Ctrl+Enter` — run current tab
- `Cmd/Ctrl+,` — settings
- `Cmd/Ctrl+\\` — toggle the developer-utilities panel

Vim mode is opt-in — turn it on under Settings → Editor.

## Stay offline

Lingua does not need a network connection to run code on the desktop build. Pyodide ships in the binary, and Go/Rust use your local toolchain. Telemetry is off by default; enable it from Settings if you want to help improve the app.

## Where to next

- [Releases](/releases) — download artifacts for every platform plus checksums.
- [Pricing](/pricing) — the four tiers and what each one unlocks.
- [Privacy](/privacy) — what we collect (and what we don't).
- [Source on GitHub](https://github.com/johnny4young/lingua) — issues, discussions, the LICENSE file.
