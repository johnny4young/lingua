---
category: surfaces
---

# OverlayCard

Elevated panel used as the body of a floating surface — command palette, quick-open, go-to-symbol. Pairs with OverlayBackdrop.

## Props

```ts
export interface OverlayCardProps {
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
}
```

## Usage

```jsx
<OverlayCard>{results}</OverlayCard>
```

Rendered from `window.Lingua.OverlayCard` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
