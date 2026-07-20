# ADR — Desktop build system

| Status | Superseded (2026-06-28) — migrated to electron-builder |
| ------ | -------- |
| Decision | Originally: stay on Electron Forge. Superseded: package with electron-builder + auto-update via electron-updater against GitHub Releases. |
| Date | 2026-04-19 (superseded 2026-06-28) |
| Revisit | n/a — superseded. |

> **Superseded 2026-06-28.** Desktop packaging moved off the Electron Forge
> makers to **electron-builder** (mac dmg+zip, win NSIS, linux AppImage) with
> **electron-updater** reading the auto-update feed from **GitHub Releases**.
> `@electron-forge/plugin-vite` is retained only as the bundler inside
> `scripts/build-desktop-bundles.mjs`; the Forge makers, publisher, CLI, and
> fuses plugin are gone (fuses are now set via `electron-builder.yml`
> `electronFuses`). The Cloudflare update Worker + R2 release mirror leave the
> desktop path; licensing stays on Cloudflare. The original 2026-04-19 analysis
> below is kept for the record.

## Context

Lingua builds desktop artifacts with Electron Forge + the Vite plugin, and
web artifacts with Vite directly. internal asks the team to pick between
three paths so future Vite-major upgrades and any eventual
migration (Tauri spike internal) land against a written baseline instead of
an implicit status quo. This ADR is that baseline.

## Options considered

### A. Stay on Electron Forge

- Current shipping path. Renderer, preload, main, and web builds all pass
  through the Forge + Vite plugin pipeline.
- Makers: squirrel (Windows), dmg / zip (macOS), deb, rpm.
- Updater: `electron-updater` wired separately (see `src/main/updater.ts`).
- Auto-unpack-natives + fuses plugins already configured.

### B. Custom electron-vite path

- Replace Forge's Vite plugin with `electron-vite` and keep
  `electron-builder` as the packager.
- Gains cleaner main/preload/renderer entrypoint config and faster HMR
  on some stacks.
- Costs: rebuild the packaging/signing steps from scratch, re-home the
  update pipeline, keep two tools in sync on every dependency bump.

### C. electron-builder only (no Forge)

- Drop Forge entirely. Use `electron-builder` for packaging and a
  hand-rolled Vite config for the renderer.
- Gains mature code-signing/notarization defaults and a large
  community around `electron-builder` updater.
- Costs: largest migration effort; the renderer's Vite plugin contract
  with Electron main loses its shared configuration.

## Scoring

| Axis | Forge (A) | electron-vite (B) | electron-builder (C) |
|------|-----------|-------------------|-----------------------|
| Vite-major agility | Depends on Forge keeping its Vite plugin current | Good — direct Vite major bumps | Good — direct Vite major bumps |
| Packaging + signing | Built-in makers cover macOS/Windows/Linux | External (electron-builder) | Strong, builder-native |
| Update ecosystem | `electron-updater` works today | `electron-updater` works too | `electron-builder` updater (different feed format) |
| CI portability | Known — `make:desktop:*` scripts exist | Medium — need to re-author CI | Medium — need to re-author CI |
| Ecosystem maturity | High | Medium | High |
| Migration effort | Zero (stay) | Medium — rebuild packaging pipeline | High — rebuild packaging + Vite wiring |

## Decision

**Stay on Electron Forge.** The current pipeline ships, the makers cover
every OS we target, and the migration effort for Options B and C is
unjustified while none of the listed axes is actively blocking the
product. The most likely pressure is Vite-major agility (the Forge Vite
plugin has lagged a release in the past), and that is a single-dep
migration under internal rather than a reason to rebuild the whole
packaging stack.

Keep `electron-builder` bookmarked for the day we need to ship a
differentiated updater feed (delta updates, staged rollouts) that
`electron-updater` does not support. Keep `electron-vite` in mind if
Forge's Vite plugin stalls through a Vite major.

## When to revisit

Open a new ADR and re-score when **any** of these becomes true:

1. internal (Vite-major upgrade) spends more than a focused afternoon on
   Forge-specific breakage and the fix does not land upstream.
2. A maker we rely on is deprecated upstream and no drop-in replacement
   lands within the Forge ecosystem.
3. Code-signing or notarization requirements outgrow the Forge makers
   (e.g. stapled Windows EV signing, custom macOS notarytool profiles
   not covered by `@electron-forge/maker-zip`).
4. A partner requires a delta-updates or staged-rollout feed shape that
   `electron-updater` cannot produce.

Until one of those triggers, this ADR stays accepted.

## Impact on adjacent items

- **internal** (Vite-major upgrade) proceeds against Forge's Vite plugin as
  the primary integration surface. No blockers identified today.
- **internal** (Tauri 2 feasibility spike) is an independent exercise — a
  Tauri migration would replace the entire shell, not just the build
  system. This ADR has no bearing on that spike.
- `packagerConfig.appCategoryType` and `packagerConfig.protocols` from
  internal remain in force; stay-on-Forge means those settings keep
  landing in packaged builds.

## Reviewers

- First recorded decision: 2026-04-19.

Future revisits should leave a new dated entry in this ADR rather than
overwriting, so the history of "why we did what we did" stays readable.
