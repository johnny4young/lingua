---
category: core
---

# IconButton

Square icon-only control for toolbars, panel headers and window chrome. No fill at rest; `active` shows the slate tint. Pair the glyph size with the box via the icon-density scale (`sm` = 24px box / 14px glyph, `md` = 28px / 16px).

## Props

```ts
export interface IconButtonProps {
  active?: boolean;
  tone?: "neutral" | "danger";
  tooltip?: string;
  tooltipSide?: "top" | "bottom" | "left" | "right";
  size?: "sm" | "md";
  className?: string;
  id?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
}
```

## Usage

```jsx
<IconButton tooltip="Run" size="md" onClick={run}>
  <Play size={16} strokeWidth={2} />
</IconButton>
```

Rendered from `window.Lingua.IconButton` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
