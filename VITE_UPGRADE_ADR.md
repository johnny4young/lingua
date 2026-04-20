# ADR — Vite 7 upgrade plan (RL-033)

| Status | Accepted — wait, prep, then bump |
| ------ | -------------------------------- |
| Decision | Plan the Vite 5 → 7 upgrade now; pull the trigger only after the four blocker peer ranges are verified. Vite 8 is intentionally skipped this round to avoid stacking the Rolldown-default churn on top of the 5 → 6 → 7 changes. |
| Date | 2026-04-20 |
| Trigger to revisit | When `@electron-forge/plugin-vite` declares Vite 7 in its peer range, OR when the team is ready to absorb a same-session Vite 8 follow-up. |

## Context

The repo is on `vite ^5.4.0` (5.4.21 installed). RL-033 calls for the
Vite-major upgrade with the verification that Electron Forge dev,
packaged desktop builds, the web build, and tests all still work. The
upgrade is non-trivial because Forge's `@electron-forge/plugin-vite`
is the fragile spot — Forge has historically lagged Vite majors by
1–2 releases and the plugin's peer range is what gates whether a
clean install resolves at all.

Pulling the trigger blind is irresponsible — a missing peer alignment
fails install, a Sass legacy API removal silently breaks `tailwind`'s
load, an `import.meta.glob` tightening drops i18n locale chunks. This
ADR lists the impact matrix and the verification + rollback shape so
the bump itself becomes a 30-minute mechanical change once the four
blocker checks pass upstream.

## Current state

- `vite`: `^5.4.0` (5.4.21 installed)
- `@vitejs/plugin-react`: `^4.3.4`
- `vitest`: `^3.0.0`
- `@electron-forge/plugin-vite`: `^7.11.1`
- Node engine: `>=24.0.0` (already past Vite 7's Node ≥ 20.19 / 22.12 floor)

## Target state

- `vite`: `^7.x` (latest stable in the 7 series at upgrade time)
- `@vitejs/plugin-react`: latest with declared `vite ^7` peer
- `vitest`: latest with declared `vite ^7` peer (likely a 3.x patch
  or a 3.x → 4.x bump — verify at install time)
- `@electron-forge/plugin-vite`: latest with declared `vite ^7` peer
- Node engine: unchanged at `>=24.0.0`

## Why Vite 7, not Vite 8

Vite 8 is GA, but it ships Rolldown closer to the default position,
which changes worker chunking semantics for our Monaco workers
(`monaco.worker`, `editor.worker`, `ts.worker`) and the per-language
runner workers (`js-worker`, `python-worker`, `go-worker`). That's a
second class of churn the team does not need stacked on top of the
5 → 6 → 7 changes. **One major at a time** keeps the verification
matrix small, the rollback narrow, and the diff bisectable. A
follow-up `VITE_8_UPGRADE_ADR.md` opens once Vite 7 is stable in
this repo and the Rolldown-default story is worth scheduling.

## Impact analysis

| Layer | Risk | Notes |
|-------|------|-------|
| `@electron-forge/plugin-vite` | **Highest** | Today's `^7.11.1` may not declare Vite 7 in its peer range. Verify upstream before scheduling the bump — this is the actual blocker. |
| Bundler (esbuild + Rollup) | **Medium** | Vite 7 still ships Rollup for prod by default; Rolldown is opt-in. Worker chunking semantics shift less than a Vite-8 jump would, but the Monaco workers and the per-language runner workers warrant a re-test. |
| esbuild-wasm transpiler | **Low** | Renderer code that imports `esbuild-wasm` directly (the TypeScript runner) is independent of Vite's internal esbuild. Watch peer-dep alignment only. |
| Sass / PostCSS / asset pipelines | **Medium** | Legacy Sass API removed in v6; Tailwind v4 path uses PostCSS only so likely fine. Verify `tailwind.config.*` continues to load. |
| `import.meta.glob` + `import.meta.env` | **Medium** | Semantics tightened in v6. Audit every `import.meta.*` use site (renderer i18n loader, telemetry env reads, license public-key env read). |
| Node target | **Low** | Vite 7 requires Node ≥ 20.19 / 22.12; repo already targets Node 24. ✅ |
| ESM-only enforcement | **Low** | Repo is already ESM (`type: module` in `package.json`, `.mts` configs). ✅ |
| `vitest` peer | **Medium** | Vitest pins a Vite version range. Vitest 3 may need a patch bump for Vite 7 peer alignment; a Vitest 4 jump may be required. Verify the exact minor at install time. |
| `@vitejs/plugin-react` peer | **Medium** | `^4.3.4` may not yet declare Vite 7. Confirm the plugin's release notes before bumping. |

## Blocker checklist (verify upstream before bumping)

1. **`@electron-forge/plugin-vite`** — `npm view @electron-forge/plugin-vite peerDependencies.vite` returns a range that includes `^7`.
2. **`@vitejs/plugin-react`** — `npm view @vitejs/plugin-react peerDependencies.vite` returns a range that includes `^7`.
3. **`vitest`** — `npm view vitest peerDependencies.vite` returns a range that includes `^7`.
4. **Sass / PostCSS** — confirm `tailwindcss` (v4 PostCSS path) continues to load with Vite 7's CSS pipeline. Tailwind v4 documentation should explicitly call out Vite 7 compatibility.

If **any** of the four checks fail, do not start the bump. Wait,
file an issue upstream, and re-run this checklist on the next
ADR revisit.

## Verification matrix (after the bump)

Run in this order — each step depends on the previous one passing:

| # | Command | Expected | What it proves |
|---|---------|----------|----------------|
| 1 | `npm install` | resolves cleanly, no peer warnings on the four blocker deps | install graph aligned |
| 2 | `npx tsc --noEmit` | clean | no breaking type changes from the upgrade |
| 3 | `npm run lint` | clean | no rule regressions |
| 4 | `npm test -- --run` | baseline test count holds | Vitest + Vite peer alignment |
| 5 | `npm run check:i18n` + `check:i18n:copy` | clean | i18n loader still works under v6/v7 `import.meta.glob` |
| 6 | `npm run build:web` | clean, hash diff in chunks expected | renderer chunking still produces the Monaco + worker shape we need |
| 7 | `npm run desktop:dev` | window loads, console clean | Forge plugin compatibility verified at runtime |
| 8 | `npm run desktop:smoke` | all five language runners green | end-to-end IPC + worker pipeline still healthy |
| 9 | `npm run make:mac` (or platform-equivalent) | packaged artifact produced | packaging path survived the bump |

If steps 1–4 pass but step 6 produces a worker-loading regression,
the most likely cause is the chunking semantics around Monaco
workers — open a follow-up issue, **roll back**, do not band-aid in
the build config.

## Rollback plan

If any verification step fails and the cause is not a 30-minute fix:

1. Revert the `package.json` + `package-lock.json` changes.
2. Pin `vite` to `5.4.21` exactly via an `overrides` block (rather
   than `^5.4.0` which would resolve forward) so the rollback is
   immune to a fresh `npm install` re-bumping.
3. `npm ci` to restore the pinned tree.
4. Document the failure in this ADR's "Reviewers" section as a new
   dated entry — that's the trigger for the next revisit.

## Decision today

**Wait.** The four blocker peer ranges have not been verified at
the time of this ADR. The implementation is a 30-minute mechanical
change once they all return clean; the blocker is upstream
ecosystem readiness, not Lingua's repo. The next time someone
opens this ADR, run the four `npm view` checks and proceed if all
four pass.

## When to revisit

Open a successor ADR (or update this one with a dated entry) when:

1. Any of the four blocker peer ranges flips clean. Schedule the
   bump in the next session.
2. A Vite 5 CVE or maintenance EOL is announced. Move the upgrade
   off the Phase 2 backlog and onto the critical path.
3. The Vite 8 Rolldown-default story stabilizes enough that
   skipping Vite 7 and going straight to Vite 8 becomes the cheaper
   path.

## Cross-links

- `BUILD_SYSTEM_ADR.md` — Stay-on-Forge means the Vite upgrade
  has to keep `@electron-forge/plugin-vite` happy. This ADR
  honors that constraint by gating the bump on the plugin's peer
  range.
- `CAPABILITY_MATRIX.md` — Unchanged. No execution-class moves.
- `TAURI_SPIKE_ADR.md` — Unchanged. The Tauri no-go decision is
  independent of which Vite major we run.

## Reviewers

- First recorded decision: 2026-04-20.

Future revisits leave a dated entry rather than overwrite, so the
history of which checks passed when stays auditable.
