# Lingua engineering documentation

Stable architecture, contributor, testing, security, and operator documentation
lives here. Product history belongs in [`CHANGELOG.md`](../CHANGELOG.md); local
planning is intentionally excluded from the published repository.

## Start here

1. [`DEVELOPMENT.md`](./DEVELOPMENT.md) — local development, quality gates, UI smoke, packaging, and Pro-mode testing.
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Electron process model, IPC filesystem bridge, project lifecycle, and watch state.
3. [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) — ownership across browser WASM, browser interpreters, desktop-native runtimes, and hybrid capabilities.
4. [`USAGE.md`](./USAGE.md) — shortcuts, deep links, plugins, browser limits, and update behavior.
5. [`TESTING.md`](./TESTING.md) — unit, component, Playwright, desktop smoke, and release validation strategy.
6. [`A11Y.md`](./A11Y.md) — automated and manual accessibility gates.
7. [`PERFORMANCE.md`](./PERFORMANCE.md) — bundle and runtime budgets. Web DuckDB and Ruby assets use the R2 `web-runtime/` path configured by `VITE_LINGUA_WEB_RUNTIME_BASE`.
8. [`RECOVERY.md`](./RECOVERY.md) — safe mode, boot-loop recovery, factory reset, and platform data paths.

## Product and runtime references

- [`CLI_USAGE.md`](./CLI_USAGE.md) — current command-line surface and exit-code contract.
- [`DEBUGGER.md`](./DEBUGGER.md) — current debugger behavior, validation, telemetry, and limitations.
- [`CAPSULE_TEST_MATRIX.md`](./CAPSULE_TEST_MATRIX.md) — portable run-capture fixture and compatibility matrix.
- [`SERVER_OBSERVABILITY.md`](./SERVER_OBSERVABILITY.md) — license and update service telemetry, alerts, and dashboards.

## Architecture decisions

- [`BUILD_SYSTEM_ADR.md`](./BUILD_SYSTEM_ADR.md) — Electron build and packaging toolchain.
- [`DEBUGGER_ADR.md`](./DEBUGGER_ADR.md) — debugger backend and UI model.
- [`ENV_VARS_ADR.md`](./ENV_VARS_ADR.md) — environment-variable scopes and execution boundaries.
- [`LANGUAGE_PACK_ADR.md`](./LANGUAGE_PACK_ADR.md) — declarative language packs.
- [`LOCAL_AI_ADR.md`](./LOCAL_AI_ADR.md) — consent-first, bring-your-own-endpoint AI.
- [`PYTHON_NOTEBOOK_KERNEL_ADR.md`](./PYTHON_NOTEBOOK_KERNEL_ADR.md) — per-notebook Python state and isolation.
- [`RUNTIME_ASSETS_ADR.md`](./RUNTIME_ASSETS_ADR.md) — vendored runtime integrity and remote oversized assets.
- [`RUNTIME_MODES_ADR.md`](./RUNTIME_MODES_ADR.md) — worker, desktop Node, and browser-preview execution.
- [`STATUS_NOTICE_PRIORITY_ADR.md`](./STATUS_NOTICE_PRIORITY_ADR.md) — deterministic status-notice priority.
- [`TAURI_SPIKE_ADR.md`](./TAURI_SPIKE_ADR.md) — retained Electron versus Tauri feasibility findings.
- [`VIM_MODE_ADR.md`](./VIM_MODE_ADR.md) — Vim-mode integration.

ADRs are additive. If a decision changes, add a new ADR that explicitly
supersedes the old one instead of rewriting historical rationale.

## Release, security, and compliance

- [`PUBLIC_RELEASE_CHECKLIST.md`](./PUBLIC_RELEASE_CHECKLIST.md) — public-source release checks.
- [`RELEASE_SECURITY.md`](./RELEASE_SECURITY.md) — security sign-off.
- [`MACOS_SIGNING.md`](./MACOS_SIGNING.md) — Developer ID signing and notarization.
- [`WINDOWS_SIGNING.md`](./WINDOWS_SIGNING.md) — Authenticode signing.
- [`THIRD_PARTY_LICENSE_REPORT.md`](./THIRD_PARTY_LICENSE_REPORT.md) — generated dependency-license evidence.
- [`security/README.md`](./security/README.md) — current security-document index.
- [`security/filesystem-denylist.md`](./security/filesystem-denylist.md) — blocked-path policy.
- [`security/license-key-registry.json`](./security/license-key-registry.json) — signing-key thumbprints and rotation metadata.
- [`build/dep-baseline-2026-05-17.md`](./build/dep-baseline-2026-05-17.md) — dependency modernization baseline.

## Operator runbooks

- [`runbooks/desktop-update-draft-validation.md`](./runbooks/desktop-update-draft-validation.md)
- [`runbooks/electron-stagewright-desktop-validation.md`](./runbooks/electron-stagewright-desktop-validation.md)
- [`runbooks/github-degraded.md`](./runbooks/github-degraded.md)
- [`runbooks/license-recovery.md`](./runbooks/license-recovery.md)
- [`runbooks/local-ai-smoke.md`](./runbooks/local-ai-smoke.md)
- [`runbooks/r2-release-mirror-setup.md`](./runbooks/r2-release-mirror-setup.md)
- [`runbooks/refund-handling.md`](./runbooks/refund-handling.md)
- [`runbooks/telemetry-pipeline.md`](./runbooks/telemetry-pipeline.md)
- [`runbooks/update-rollback.md`](./runbooks/update-rollback.md)
- [`runbooks/webhook-replay.md`](./runbooks/webhook-replay.md)

## Product collateral

- [`press-kit/`](./press-kit/) — launch copy, pricing reference, boilerplate, and founder bio.
- [`seo-pages/`](./seo-pages/) — source content for language-intent pages on linguacode.dev.
- [`lessons/`](./lessons/) — classroom and guided-practice drafts.

## Documentation policy

- Document current behavior and stable decisions, not private tickets or sprint history.
- Remove completed planning artifacts; preserve shipped traceability in the changelog, README, ADRs, tests, and operator docs.
- Never add secrets, machine-local paths, customer data, or private planning identifiers.
- Use ISO dates (`YYYY-MM-DD`) and keep commands executable from the repository root.
