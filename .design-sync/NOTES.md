# design-sync notes — Lingua

Repo-specific gotchas for anyone re-running `/design-sync` here. Read before
touching `config.json`.

## This repo is an app, not a component package

Lingua's `package.json` `main` is `.vite/build/main.js` — the **Electron main
process**, which contains no React. `dist/` is the built web app, not a library.
Pointing the converter at either produces garbage. Instead the sync uses a
synthetic package root at `.design-sync/pkgroot/`, symlinked in as
`node_modules/lingua`, whose `package.json` deliberately declares **no** `main`
or `module` so the converter falls into its synth-entry mode over `src/`.

`pkgroot/` is machine-made scaffolding. Regenerate it with these steps if it is
missing (fresh clone) or if the kit gains files:

1. `mkdir -p .design-sync/pkgroot/src` and symlink every file from
   `src/renderer/components/ui/` into it — **except `chrome.tsx`**.
2. Keep the committed `pkgroot/src/chrome.tsx` shim. It re-exports chrome minus
   `Kbd`: `chrome.tsx` and `ModalShell.tsx` both export a `Kbd`, and the ESM
   star-export collision silently drops the name off `window.Lingua`
   (validate reports `[BUNDLE_EXPORT]`). ModalShell's is canonical — its own
   JSDoc notes chrome's carries the legacy `.kbd-shell` rounded-lg styling.
3. Emit the declaration tree (**from the real paths, not the symlinks** — tsc
   resolves `../../utils/cn` relative to the symlink location and fails):

   ```
   npx tsc --ignoreConfig --declaration --emitDeclarationOnly --skipLibCheck \
     --jsx react-jsx --moduleResolution bundler --module esnext --target es2022 \
     --outDir .design-sync/pkgroot/types \
     src/renderer/components/ui/*.tsx src/renderer/components/ui/*.ts
   ```

   Without this the `.d.ts` props come out as `[key: string]: unknown` for all
   23 components — a useless contract for the design agent. `pkgroot/types/index.d.ts`
   (committed) re-exports the tree and is what `package.json` `types` points at.
4. `node .design-sync/gen-i18n-subset.mjs` — regenerates `pkgroot/i18n-en.json`
   from the real EN catalog. The full catalog is 324 KB and would triple the
   bundle, so only the `modal.*` and `ui.*` prefixes ship.
5. `ln -sfn "$PWD/.design-sync/docs" .design-sync/pkgroot/docs`
6. Symlink `pkgroot/styles.css` at the compiled web CSS (see below), and copy
   the two JetBrains Mono woff2 from `public/fonts/` next to `pkgroot/fonts.css`.

## cssEntry points at a content-hashed file

`cfg.cssEntry` resolves to `pkgroot/styles.css`, a symlink at
`dist/web/assets/index-<hash>.css` — the **compiled** Tailwind, which is the
only place the utilities and the resolved token layer exist together.
`src/renderer/index.css` is Tailwind v4 source (`@import 'tailwindcss'`) and is
useless to the converter. **The hash changes on every `pnpm run build:web`**, so
re-point the symlink after a rebuild or the sync ships a stale stylesheet.

## The preview provider does three things

`pkgroot/ds-provider.tsx` (committed, exported as `window.Lingua.DsProvider`):
i18n context, the product dark theme, and a full-height surface. Two of those
were learned the hard way:

- The theme attribute must go on `<html>`, **not** a wrapper div. `FileDropZone`
  styles its idle state with `bg-background/65`, whose `color-mix()` chain
  through the legacy `--app-*` bridge only settles when the theme is declared at
  the document root. On a wrapper div the dropzone rendered as an opaque light
  grey slab in dark mode.
- The wrapper needs `minHeight: 100vh`. `ConfirmDialog` is `fixed inset-0` and
  centers on the window; against a short wrapper box the capture cropped its
  title off, and no `viewport` override fixed it.

## Known render warns — expected, not new

- `[FONT_MISSING] "Inter"` — **deliberate.** Lingua declares Inter only as the
  head of a fallback stack and ships no file, so the product renders with
  system-ui on most machines. Shipping Inter would make previews diverge from
  the app. JetBrains Mono *is* shipped and *is* wired via `cfg.extraFonts`.
- `Tooltip` cards show only their trigger. The bubble is hover-only and cannot
  be captured statically; faking one would violate the no-lookalike rule.
- `TypePill` renders all eight `kind` values identically. This is product truth:
  the per-type colors live in Monaco-scoped selectors, and the bare
  `[data-type-pill=…]` rules sit in `@layer components`, which Tailwind's
  `utilities` layer outranks. Documented in `TypePill.md` so the design agent
  does not rely on `kind` for color.

## Re-sync risks

- **The `pkgroot` scaffold can silently rot.** New files in
  `src/renderer/components/ui/` are not picked up until they are symlinked into
  `pkgroot/src/`, and the declaration tree is a build artifact — a changed prop
  that is not re-emitted ships a stale contract. Re-run steps 1–4 above every
  sync, not just when something looks wrong.
- **The i18n subset is prefix-filtered.** A kit component that starts reading a
  key outside `modal.*` / `ui.*` will render that raw key in its card. Widen
  `PREFIXES` in `gen-i18n-subset.mjs` when that happens.
- **`node_modules/lingua` is a symlink that no install recreates.** It is gone
  after a fresh clone or a `node_modules` wipe; re-create it before building.
- The 23 components are `src/renderer/components/ui` only. The other ~240
  `.tsx` files under `src/renderer/` are app screens, not library surface, and
  are deliberately out of scope.
- Preview compositions inline small amounts of realistic copy. They are
  illustrative, not sourced from the product, so they will not track copy
  changes in the app.

## `styles.css` is hand-merged after the build — re-do it every sync

The converter writes a two-line `ds-bundle/styles.css` (fonts + `_ds_bundle.css`).
The uploaded one must ALSO keep the project's original `tokens/*.css` imports:
the curated group cards (`components/<group>/<group>.card.html`, which are
hand-authored and were deliberately kept) read token names that exist only in
that chain — `var(--font-sans)` is the one that breaks first. Order matters:
`tokens/` first, `_ds_bundle.css` last, so the shipping app's values win on any
shared name and its app-only additions come along.

**A plain rebuild overwrites this file.** Re-apply the merge before uploading, or
the curated cards lose their font and spacing tokens. This also means the anchor's
`styleSha` is computed against the pre-merge file, so the next sync will see
styling as changed — expected, not a fault.

## The project intentionally holds MORE than this build produces

The Claude Design project predates this sync and is hand-authored. On the first
sync (2026-08-27) these were **deliberately kept**, and a future run must not
delete them just because the converter does not emit them:

- `components/{core,feedback,forms,surfaces}/` flat files for `Badge`, `Button`,
  `Dialog`, `Toast`, `Checkbox`, `Input`, `Select`, `Switch`, `Card`, `Tabs` —
  design-system surface with **no counterpart** in `src/renderer/components/ui`.
  Deleting them removes capability the repo cannot replace.
- The four `<group>.card.html` group cards. They are self-contained: each one
  re-implements its primitives as inline **specimen copies** and does not import
  the sibling `.jsx`, so deleting a sibling does not break the card. That is why
  the duplicated `IconButton` / `Kbd` / `Tooltip` flat files could safely go —
  their contracts contradicted the newly generated ones.
- `guidelines/*.card.html` (9), `tokens/*` (8), `templates/**`, the root
  `* Prototipo Interactivo.html` files, `SKILL.md`, `design-sync.md`.

Deleted on that run: the 42 `components/*.jsx` prototypes and the 9 flat files
for the three colliding components.

**There is no anchor covering the kept files.** `_ds_sync.json` only describes
what this build produces, so any future full-scope delete pass will offer to
remove everything above. Re-read this section before approving deletes.
