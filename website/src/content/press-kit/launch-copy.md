# Launch copy drafts

Pre-written posts for Phase 2 distribution. Every draft here has been
cross-checked against shipped reality — no claim should outrun the
actual implementation. Edit in this file, then commit, then post.

## Show HN

**Title**: Show HN: Lingua — Multi-language desktop code runner (JS,
TS, Go, Python, Rust)

**Body**:

I built Lingua because I was tired of switching between five different
playgrounds to answer "does this Go / Python / TypeScript snippet
actually work?" questions.

It's a desktop app (Electron) that runs JavaScript, TypeScript, Python
(Pyodide), Go (compiled locally), and Rust (`rustc`) inside one
Monaco-powered editor. Offline-first — the renderer is self-contained
and the runners for JS, TS, and Python run in Workers so no network
trip is needed. Go and Rust compile via your local toolchain.

Built-in goodies:
- HTTP request workspace (reusable environments, secret-aware
  `{{variables}}`, cURL + Postman import) and a DuckDB-powered SQL
  workspace with a Monaco SQL editor
- Cell-based notebooks that run TypeScript and Python, share variables
  across cells, and import/export Jupyter `.ipynb`
- Smart paste (share links, run capsules, cURL, stack traces, large
  JSON) plus inline lint with quick-fixes for JS/TS
- JSON formatter, regex tester, Base64 / URL / UUID / hash / timestamp
  / JWT tools, color converter, diff viewer
- Format-on-save via Prettier, gofmt, rustfmt, ruff (falls back to
  black)
- Project indexing with fuzzy quick-open and project-wide search
- Custom keyboard shortcut editor with preset import/export
- Deep links (`lingua://`) so you can share file paths or snippet IDs
  from a browser into the app

Source-available (commercial license) on GitHub. Free tier is single-
tab + 5 snippets + JS/TS/Python. Monthly and Pro unlock unlimited
tabs and snippets, plus Go and Rust runners. Education
access is free for verified students and teachers. 14-day Pro trial
available without a credit card — Settings → License inside the app.

Honest limitations today:
- Go and Rust need their toolchains installed locally — web build
  surfaces that as "desktop only"
- The debugger is JS/TS only (preview); rich language intelligence for
  Python, Rust, and Go relies on the local LSP (rust-analyzer / gopls),
  and the web build keeps those languages validate-only
- Opt-in telemetry is off by default; crash reporting is opt-in too

Happy to answer anything about the runner architecture, the
monetization story, or why I'm not competing with RunJS on pure JS
ergonomics.

Download: https://linguacode.dev  |  Repo: (link)

---

## Product Hunt

**Tagline**: Multi-language desktop code runner — JS, TS, Go, Python,
Rust in one offline-first app.

**Description**:

Lingua replaces the half-dozen browser tabs that sit alongside your
usual code runner. One app, five languages, notebooks, HTTP and SQL
workspaces, built-in developer utilities, offline-first, and
source-available.

**First comment (maker)**:

Hi! I'm the maker of Lingua. A few things the tagline doesn't fit:

- Every runner ships with language-aware inline results (`//=>` magic
  comments) so the scratchpad feels like a REPL with context.
- The developer utilities (JSON, regex, Base64, hash, JWT, color, diff,
  etc.) are first-class — Cmd+K opens the workspace, then search and run.
- Keyboard shortcuts are rebindable with a preset import/export flow,
  and theme presets round-trip as JSON.
- Free tier is single-tab + 5 snippets + JS/TS/Python. Monthly and Pro
  unlock unlimited tabs and snippets, plus Go and Rust runners.

Happy to answer anything here.

---

## r/golang

**Title**: I built a desktop code runner that treats Go as a
first-class language alongside JS/TS, Python, and Rust

**Body**:

Most playgrounds either run Go on a remote server or leave you stuck
with stdlib-only playground sandboxing. Lingua runs `go build` on your
local toolchain (desktop app) so you can `import` modules from your
GOPATH and still get inline results in a Monaco editor.

What Go-specific work went in:
- `go build` with `GOOS=js GOARCH=wasm` for inline execution
- Local `wasm_exec.js` resolution — works with every Go version that
  ships the WASM runtime
- `gofmt` is the default format-on-save handler for `.go` files
- Go compile errors normalize into Monaco markers with source
  positions, not as stderr dumps

What's honest about the limitations:
- You need a local Go toolchain (the web build surfaces that
  explicitly)
- No Go LSP yet — only Monaco's keyword completion
- No module-graph-level intelligence; this is a scratchpad, not an IDE

Free tier doesn't include Go execution (it's a Pro unlock). Source-
available on GitHub; download at https://linguacode.dev.

---

## r/rust

**Title**: A desktop code runner with real `rustc` execution (not a
Rust Playground mirror)

**Body**:

Lingua compiles and runs Rust on your local toolchain from inside a
Monaco editor. No remote sandbox, no 10-second timeout, no missing
crate. Full cargo crates work because the compiler is yours.

What Rust-specific plumbing shipped:
- `rustc --emit=bin` + spawn, native subprocess
- `rustfmt` is the default format-on-save handler for `.rs` files
- `rust-analyzer` powers desktop diagnostics, completions, hover, and
  signature help when it is installed
- Rust compile errors land as Monaco markers (line + span) instead of
  stderr blobs
- Runtime stderr / stdout stream into the inline result panel so you
  see panics mapped back to the source

Known limits:
- Needs `rustc` on PATH (local toolchain)
- Rust language intelligence needs `rust-analyzer` on PATH; Lingua
  shows an install hint or restart action when it is missing or crashes

Free tier doesn't include Rust execution (Pro unlock). Source-available
on GitHub; download at https://linguacode.dev.

---

## r/Python

**Title**: Lingua: a desktop Python REPL that also runs JS / TS / Go
/ Rust without leaving the editor

**Body**:

Built as a multi-language scratchpad, not a Python-only tool — but the
Python story is deliberately first-class:

- Pyodide-in-a-Worker so there's no Python toolchain to install
- Pyodide runs in both the desktop app and the web build
- Format-on-save uses `ruff format` (falls back to `black`) when they
  are on PATH in desktop mode
- Inline result magic comments (`#=>`) show values next to the line
  that produced them

Newer Python surface:
- Cell-based notebooks run Python cells, share variables across cells,
  and import/export Jupyter `.ipynb` (plus the native `.linguanb`)

What's not there yet:
- No `pip install` of arbitrary packages — `micropip`-available
  packages only, same as Pyodide itself

Python is in the Free tier. Source-available; download at
https://linguacode.dev.
