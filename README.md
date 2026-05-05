# Lingua

[![CI](https://github.com/johnny4young/lingua/actions/workflows/ci.yml/badge.svg)](https://github.com/johnny4young/lingua/actions/workflows/ci.yml)
[![Node 24+](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![License: Source-available (commercial)](https://img.shields.io/badge/license-source--available%20(commercial)-6f42c1)](./LICENSE)

**Multi-language desktop code runner — JavaScript, TypeScript, Python, Go, and Rust in one offline-first Monaco-powered app.** Lingua combines Monaco Editor, a project file tree, inline console output, and language-specific execution backends for both desktop and web builds. It is the multi-language answer to RunJS: the same "open, write, run" ergonomics, but with Go, Rust, and Python as first-class citizens instead of JavaScript-only.

**Marketing site:** [linguacode.dev](https://linguacode.dev) — downloads, pricing, press kit, language-specific landing pages.
**Web app:** [app.linguacode.dev](https://app.linguacode.dev) — the in-browser build.

The marketing site lives in a separate repo (`johnny4young/lingua-marketing`); see [`docs/MARKETING_SITE_ADR.md`](./docs/MARKETING_SITE_ADR.md) for the rationale.

## Pricing and licensing

Lingua is a commercial product distributed under a source-available license — see [`LICENSE`](./LICENSE) for the full text. The repository is public so the community can read the source, audit security, and submit contributions; production, paid, hosted, redistributed, educational-at-scale, or other commercial use requires a separate commercial license from the Licensor. The public checkout and download surface is live at [`linguacode.dev`](https://linguacode.dev); the rights granted by this repository remain those described in `LICENSE`.

Public tiers:

- **Free** — personal evaluation, self-learning, single-user non-commercial local use.
- **Pro** ($5/month) — paid subscription unlocking the full feature set.
- **Pro Lifetime** ($59 once) — same Pro entitlements without a recurring subscription.
- **Team** ($3/seat/month) — Pro entitlements plus seat management.
- **Education** — free, renewable, in-app verification for verified students and educators.

The public pricing summary lives at [`linguacode.dev/pricing`](https://linguacode.dev/pricing) (canonical surface) and mirrors [`docs/press-kit/pricing-one-pager.md`](./docs/press-kit/pricing-one-pager.md) for in-repo reference.

## Who it is for

- Developers juggling JavaScript, TypeScript, Python, Go, and Rust snippets across Slack, Stack Overflow answers, and interview prep.
- Teachers and students who want a single offline-capable multi-language sandbox that runs on laptops without per-language CLI setup.
- Teams who need a lightweight, reviewable, commercial-licensed alternative to web-hosted playgrounds for proprietary code.

## Current capabilities

- Desktop app (Electron Forge + Vite + React 19 + TypeScript) and a parallel web build for browser-based usage.
- Monaco-powered editor with tabs, templates, inline execution results, magic-comment value surfacing, command palette, quick open, project-wide search, and snippet library.
- Built-in runners for JavaScript, TypeScript, Python (Pyodide), Go (compiled locally to WASM), and Rust (`rustc` native subprocess on desktop).
- Validate-only modes for JSON, YAML, `.env`, CSV, Dockerfile, `.editorconfig`, `.gitignore`, `Makefile`; view-only handling for TOML and INI/config files.
- 29 focused developer-utility panels (JSON, regex, Base64/URL/UUID/hash/timestamp/JWT, color, diff, beautify/minify, case/encoding, QR, Lorem, SVG→CSS, HTML→JSX, cURL→code, YAML↔JSON, JSON↔CSV, Markdown preview, SQL formatter) reachable from the toolbar wrench and the Command Palette.
- Format-on-save via Prettier (JS/TS/JSON/CSS) plus desktop-only gofmt, rustfmt, and Python formatters (ruff preferred, black fallback).
- Curated developer fonts with a ligature toggle, theme presets with versioned JSON export/import, persisted resizable shell layout with a compact-shell drawer for narrow widths, and a What's New overlay backed by [`CHANGELOG.md`](./CHANGELOG.md).
- Built-in guided onboarding tour, customizable keyboard shortcuts with preset switching and JSON export/import, and `lingua://` deep links for `open`, `new`, and `snippet` entry points.
- Commercial license-key infrastructure: Ed25519-signed offline-verifiable tokens, renderer store with active/grace/invalid states, and entitlement-based feature gating (Free ceilings of 1 tab / 5 snippets / JS-TS-Python).
- Opt-in privacy-respecting telemetry and crash reporting, off by default, with an explicit allow-list redactor (never user code or file paths) and build-level kill switches.

## Runtime model

- JavaScript and TypeScript run in renderer workers; Monaco diagnostics target the same ES2022 + Web Worker contract used by execution.
- Python runs through Pyodide in both the desktop app and the web build.
- Go is compiled to WebAssembly through the desktop IPC bridge and a local Go toolchain.
- Rust is compiled and executed natively through the desktop IPC bridge and a local Rust toolchain.
- The web build stubs Go and Rust execution because local toolchains are not available in the browser.

For deeper architecture detail and the per-capability execution-class decision, see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and [`docs/CAPABILITY_MATRIX.md`](./docs/CAPABILITY_MATRIX.md).

## Requirements

| Dependency     | Version | Notes                                             |
| -------------- | ------- | ------------------------------------------------- |
| Node.js        | >= 24   | Required for local development, tests, and builds |
| Go             | >= 1.21 | Required only for desktop Go execution            |
| Rust (`rustc`) | stable  | Required only for desktop Rust execution          |

## Quickstart

```bash
git clone https://github.com/johnny4young/lingua.git
cd lingua
npm install
npm run dev:desktop
```

Common commands:

```bash
npm run dev:web          # browser-only iteration
npm run dev:desktop      # real Electron app + renderer dev server
npm run dev:web:pro      # web build with throwaway dev license token printed
npm run dev:desktop:pro  # desktop build with throwaway dev license token printed
npm run smoke:desktop    # repeatable Electron smoke flow across all 5 languages
npm run build:web        # static web build for app.linguacode.dev
```

Full contributor workflow — quality checks, i18n contributor flow, UI smoke against the web preview, desktop launcher flags, packaged-app smoke variants, build commands, automation/delivery — lives in [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md).

End-user reference — keyboard shortcuts, `lingua://` deep links, plugin manifest format, browser-only limitations, browser file access, update behavior — lives in [`docs/USAGE.md`](./docs/USAGE.md).

### Windows contributors: enable symlinks before cloning

`CLAUDE.md` is a git symlink (`mode 120000`) that points at `AGENTS.md`. Linux and macOS follow it transparently. Windows needs one-time setup so git materializes it as a real symlink instead of a text file containing the word `AGENTS.md`:

1. Enable **Developer Mode** (Settings → Privacy & security → For developers → Developer Mode on).
2. `git config --global core.symlinks true` before `git clone`.

Without this, `CLAUDE.md` still works as a pointer — it just shows up as a regular text file containing `AGENTS.md`. Edit `AGENTS.md` in either case; never edit the symlink.

## Where to read next

Contributor and operator entry points:

- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md) — clone/install, dev/test/smoke/build commands, Pro testing, automation/delivery.
- [`docs/USAGE.md`](./docs/USAGE.md) — keyboard shortcuts, deep links, plugin manifest format, browser-only limitations, update behavior.
- [`AGENTS.md`](./AGENTS.md) — canonical guidance for any agent (Claude Code, Cursor, Codex, Aider) working in this repo. `CLAUDE.md` is a symlink pointing to it.
- [`RELEASE.md`](./RELEASE.md) — release operator checklist (preconditions, release steps, validation gate, rollback plan).

Architecture and decision records:

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — process model, IPC filesystem bridge, watch-state, project lifecycle.
- [`docs/CAPABILITY_MATRIX.md`](./docs/CAPABILITY_MATRIX.md) — which execution class owns each capability today, with promotion rules.
- [`docs/README.md`](./docs/README.md) — full ADR index (build system, debugger, env vars, language packs, Tauri spike, Vim mode, Vite upgrade, marketing site, runtime assets).
- [`src/renderer/README.md`](./src/renderer/README.md) — renderer folder map, state ownership, styling rules.

Public-release and security:

- [`docs/PUBLIC_RELEASE_CHECKLIST.md`](./docs/PUBLIC_RELEASE_CHECKLIST.md) — gates for changing the source repository visibility to public.
- [`docs/RELEASE_SECURITY.md`](./docs/RELEASE_SECURITY.md) — public-release security sign-off checklist.
- [`SECURITY.md`](./SECURITY.md), [`PRIVACY.md`](./PRIVACY.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) — public security reporting, privacy posture, contribution rules, runtime dependency notices.

Launch and product collateral:

- [`docs/MARKETING_SITE_ADR.md`](./docs/MARKETING_SITE_ADR.md) — separate-repo decision for [linguacode.dev](https://linguacode.dev), Cloudflare Pages auto-deploy.
- [`docs/press-kit/`](./docs/press-kit/) — Phase 2 launch asset boilerplate (en + es) — product descriptions, pricing one-pager, founder bio, Show HN / Product Hunt / subreddit drafts.
- [`docs/seo-pages/`](./docs/seo-pages/) — SEO landing page scaffolds (five language-intent pages) consumed by `linguacode.dev`.
- [`docs/lessons/`](./docs/lessons/) — first-slice guided lesson scaffolds (en + es).

## License

Lingua is a commercial product distributed under a source-available license. The full terms live in [`LICENSE`](./LICENSE); the short version is: the repository is public for evaluation, contributor review, and security auditing, but production, paid, hosted, redistributed, educational-at-scale, or other commercial use requires a separate commercial license from the Licensor. The public checkout is live at [`linguacode.dev`](https://linguacode.dev). Redistributing packaged binaries or competing hosted offerings is not permitted.
