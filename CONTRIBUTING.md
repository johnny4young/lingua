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
pnpm run preflight --full
```

`preflight` runs the static CI gates (changelog, type checks, lint, i18n, dead
code) and, with `--full`, the web build and performance budget. The pre-push
hook installed by `pnpm install` runs it without `--full`.

A `feat`, `fix` or `perf` commit that changes shipped code needs a CHANGELOG.md
entry for the next version or a `Changelog: none` line in its body. Commits that
touch only `.github/`, `.githooks/`, `docs/`, `tests/` or root Markdown are
exempt.

Renderer-facing changes also need a running-app smoke pass. The default path is
the web preview plus a browser console check for zero errors. Desktop-only IPC,
native execution, updater, or packaged behavior should use the desktop smoke
path documented in `README.md` and `RELEASE.md`.

## Documentation

- Public setup, licensing, privacy, security, and release docs should stay in
  root-level or `docs/` Markdown files.
- Do not add machine-local absolute links.
- Do not describe plugin support as a finished third-party extension ecosystem
  until the UI and runtime model support that claim.

## Commit Hygiene

Use Conventional Commits. Do not add AI co-authorship trailers, generated-by
watermarks, private local paths, or tool-specific signatures to commits or PR
descriptions.
