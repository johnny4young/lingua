---
category: core
---

# StatusBadge

Uppercase mono badge for a persistent state: license tier, save state, or a run outcome. `dot` prepends a 5px dot tinted to the tone. Green (`success`) is reserved for Run/Success — never as a generic accent.

## Props

```ts
export interface StatusBadgeProps {
  tone: "neutral" | "success" | "warning" | "error" | "info" | "free" | "pro" | "unsaved";
  /** Leading 5px dot tinted to the tone's foreground (via `bg-current`). */
  dot?: boolean;
  children: React.ReactNode;
}
```

## Usage

```jsx
<StatusBadge tone="pro">Pro</StatusBadge>
<StatusBadge tone="unsaved" dot>Unsaved</StatusBadge>
```

Rendered from `window.Lingua.StatusBadge` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
