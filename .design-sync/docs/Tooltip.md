---
category: feedback
---

# Tooltip

Hover/focus label for a control that has no visible text. Wraps exactly one element and clones it — the child must forward ref and props. Keep `content` to a few words; it is not a popover.

## Props

```ts
export interface TooltipProps {
  content: string;
  children: ReactElement<unknown, string | JSXElementConstructor<any>>;
  side?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
}
```

## Usage

```jsx
<Tooltip content="Copy output" side="bottom">
  <IconButton tooltip="Copy"><Copy size={16} /></IconButton>
</Tooltip>
```

Rendered from `window.Lingua.Tooltip` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
