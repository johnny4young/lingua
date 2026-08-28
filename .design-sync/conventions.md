# Lingua — Signal-Slate

Lingua is a keyboard-first developer workbench (Electron + React 19 + Monaco):
editor, SQL/HTTP workspaces, notebook. These components are the real shipping
primitives from `src/renderer/components/ui`, compiled from source — not a
reimplementation.

## Wrap every design in `DsProvider`

`window.Lingua.DsProvider` sets the product theme on `<html>` and supplies the
i18n context. Without it `ModalShell`, `ModalFooterLegend` and `FileDropZone`
render raw translation keys (`modal.legend.navigate`), and every token resolves
to the light map instead of the product default.

```jsx
const { DsProvider, ModalShell, ModalFooterLegend, SpecCard, SpecRow, Kbd } = window.Lingua;

<DsProvider>
  <ModalShell header="Keyboard shortcuts" onClose={close}
              footerLegend={<ModalFooterLegend navigate close />}>
    <SpecCard>
      <SpecRow label="Run scratchpad" control={<Kbd>⌘↵</Kbd>} />
      <SpecRow label="Command palette" control={<Kbd>⌘K</Kbd>} last />
    </SpecCard>
  </ModalShell>
</DsProvider>
```

**Dark is the product default.** Light exists and is fully token-driven, but
design for dark unless asked otherwise.

## Styling idiom — Tailwind utilities named after the tokens

Style your own layout glue with these utility families. They are generated from
the DS tokens, so they track the theme automatically. Do not invent color
names, and do not hard-code hex values.

| Family | Real class names |
|---|---|
| Surfaces | `bg-bg-base` · `bg-bg-panel` · `bg-bg-panel-alt` · `bg-bg-inset` |
| Text | `text-fg-base` · `text-fg-muted` · `text-fg-subtle` · `text-accent` |
| Borders | `border-border-subtle` · `border-border-default` · `border-border-strong` |
| Accent | `bg-accent` · `text-accent` |
| Status | `bg-success-bg` / `text-success-fg`, and the same `-bg` / `-fg` / `-border` pattern for `warning`, `error`, `info` |
| Type scale | `text-h1` · `text-h2` · `text-h3` · `text-body` · `text-body-sm` · `text-caption` · `text-micro` · `text-eyebrow` |
| Radius | `rounded-sm` (4px) · `rounded-md` (6px) · `rounded-lg` (10px) |
| Mono | `font-mono` — JetBrains Mono, for code, keycaps, versions and type tags |

Non-negotiables, in order of how often they get broken:

1. **Green is reserved for Run and Success.** Never a generic accent. The one
   green fill in the product is `RuntimeSelector`'s Run/Stop button.
2. **One accent hue** — slate at hue 210. Multi-hue exists only for syntax
   highlighting and the four semantic status colors.
3. **Icons are stroke-based Lucide-family SVGs**, 1.5–2 stroke width. **No
   emoji, ever.**
4. **Sentence case** in UI copy. Second person. No exclamatory marketing voice.
5. Reach for a library component before styling a lookalike — there is already
   a `Kbd`, a `Pill`, a `StatusBadge`, an `EmptyState` and a `SpecRow`.

## Where the truth lives

- `_ds/<folder>/styles.css` and its `@import` closure — the shipped token layer
  and every compiled utility. Read it before inventing a class.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component usage, with the
  real prop contract in `<Name>.d.ts`. Read the component's own doc before
  guessing its API; several carry caveats you cannot infer from the props (see
  `TypePill`, whose per-type colors only apply inside the editor).

## Composition notes worth knowing

- `SpecRow` lives inside `SpecCard`, which lives inside `SettingsSection` —
  that is the whole Settings surface.
- `OverlayBackdrop` + `OverlayCard` is the palette/quick-open pattern.
  `OverlayBackdrop` moves focus into itself on mount, so give it a focusable
  child (an input) or focus lands on the scrim.
- `ModalShell` is the only dialog frame — it owns the scrim, focus trap and
  Esc handling. `ConfirmDialog` is the two-choice special case.
