# Contributing

Thanks for helping improve Lingua. This repository is source-available under
the commercial license in `LICENSE`; it is not an open-source license. By
submitting a contribution, you agree to the contribution grant described there.

## Setup

```bash
pnpm install
pnpm run dev:web
```

Desktop development uses:

```bash
pnpm run dev:desktop
```

Use `.env.example` as the reference for local env overrides. Do not commit
private keys, API tokens, signing certificates, webhook secrets, or real license
tokens.

## Expected Checks

Before proposing a non-trivial change, run the relevant local checks:

```bash
pnpm test -- --run
pnpm exec tsc --noEmit
pnpm run lint
pnpm run check:i18n
pnpm run check:i18n:copy
pnpm run build:web
```

Renderer-facing changes also need a running-app smoke pass. The default path is
the web preview plus a browser console check for zero errors. Desktop-only IPC,
native execution, updater, or packaged behavior should use the desktop smoke
path documented in `README.md` and `RELEASE.md`.

## Documentation

- Public setup, licensing, privacy, security, and release docs should stay in
  root-level or `docs/` Markdown files.
- Canonical planning state lives in `docs/ROADMAP.md`.
- Do not add machine-local absolute links.
- Do not describe plugin support as a finished third-party extension ecosystem
  until the UI and runtime model support that claim.

## Commit Hygiene

Use Conventional Commits. Do not add AI co-authorship trailers, generated-by
watermarks, private local paths, or tool-specific signatures to commits or PR
descriptions.
