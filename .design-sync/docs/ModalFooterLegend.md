---
category: surfaces
---

# ModalFooterLegend

Keycap legend rail for a modal footer. Each boolean turns on one hint (navigate / select / open / close) rendered as Kbd + label.

## Props

```ts
export interface ModalFooterLegendProps {
  /** ↑↓ navigate. */
  navigate?: boolean;
  /** ↵ select. */
  select?: boolean;
  /** ↵ open. */
  open?: boolean;
  /** esc close. */
  close?: boolean;
  /** Optional extra classes on the rail container. */
  className?: string;
}
```

## Usage

```jsx
<ModalFooterLegend navigate select close />
```

Rendered from `window.Lingua.ModalFooterLegend` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
