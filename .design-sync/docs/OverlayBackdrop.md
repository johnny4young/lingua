---
category: surfaces
---

# OverlayBackdrop

Scrim behind a floating surface. `align="top"` seats the card near the top of the viewport (palette-style); `center` centers it. `onClose` fires on scrim click.

## Props

```ts
export interface OverlayBackdropProps {
  align?: "top" | "center";
  onClose?: () => void;
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
}
```

## Usage

```jsx
<OverlayBackdrop align="top" onClose={close}>
  <OverlayCard>{palette}</OverlayCard>
</OverlayBackdrop>
```

Rendered from `window.Lingua.OverlayBackdrop` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
