---
category: core
---

# MonoBadge

Monospace variant of Pill for machine-shaped values — versions, runtime ids, exit codes. Five tones.

## Props

```ts
export interface MonoBadgeProps {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "error";
  className?: string;
}
```

## Usage

```jsx
<MonoBadge tone="neutral">v1.3.0</MonoBadge>
```

Rendered from `window.Lingua.MonoBadge` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
