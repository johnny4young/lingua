---
category: core
---

# TypePill

Tiny pill naming a value type in inline results (`string`, `number`, `object`, …).

**It renders neutral by default.** The per-type colors live in editor-scoped rules
(`.monaco-editor.vs-dark .lingua-inline-result-pill[data-type-pill=…]`), and the bare
`[data-type-pill=…]` rules sit in `@layer components`, which Tailwind's `utilities`
layer outranks. So outside the Monaco inline-result decoration every `kind` looks the
same — expect a neutral mono chip, and do not rely on `kind` for color in new surfaces.

## Props

```ts
export interface TypePillProps {
  kind: string;
  className?: string;
}
```

## Usage

```jsx
<TypePill kind="string" />
```

Rendered from `window.Lingua.TypePill` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
