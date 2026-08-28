---
category: feedback
---

# InlineMarker

Inline value chip rendered next to a line of code in the editor gutter lane — the scratchpad result display. `watch` marks a pinned expression.

## Props

```ts
export interface InlineMarkerProps {
  /** The evaluated value, e.g. "50". */
  value: string;
  /** The runtime type tag, e.g. "number". */
  type: string;
  /** When set, prepends the accent */
  watch?: boolean;
  className?: string;
}
```

## Usage

```jsx
<InlineMarker value="42" type="number" />
```

Rendered from `window.Lingua.InlineMarker` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
