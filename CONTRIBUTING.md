# Contributing

Thanks for helping improve Lingua. This repository is source-available under
the commercial license in `LICENSE`; it is not an open-source license. By
submitting a contribution, you agree to the contribution grant described there.

## Setup

```bash
npm install
npm run dev:web
```

Desktop development uses:

```bash
npm run dev:desktop
```

Use `.env.example` as the reference for local env overrides. Do not commit
private keys, API tokens, signing certificates, webhook secrets, or real license
tokens.

## Expected Checks

Before proposing a non-trivial change, run the relevant local checks:

```bash
npm test -- --run
npx tsc --noEmit
npm run lint
npm run check:i18n
npm run check:i18n:copy
npm run build:web
```

Renderer-facing changes also need a running-app smoke pass. The default path is
the web preview plus a browser console check for zero errors. Desktop-only IPC,
native execution, updater, or packaged behavior should use the desktop smoke
path documented in `README.md` and `RELEASE.md`.

## Documentation

- Public setup, licensing, privacy, security, and release docs should stay in
  root-level or `docs/` Markdown files.
- Planning state lives in `docs/ROADMAP.md`, `docs/SPRINT-PLAN.md`,
  `docs/PLAN.md`, and `docs/BACKLOG.md`.
- Do not add machine-local absolute links.
- Do not describe plugin support as a finished third-party extension ecosystem
  until the UI and runtime model support that claim.

## Commit Hygiene

Use Conventional Commits. Do not add AI co-authorship trailers, generated-by
watermarks, private local paths, or tool-specific signatures to commits or PR
descriptions.
