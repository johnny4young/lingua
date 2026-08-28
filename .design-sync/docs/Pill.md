---
category: core
---

# Pill

Soft rounded label for a category or count. Six tones map to the status token families; `neutral` is the default and the only one safe for non-semantic labels.

## Props

```ts
export interface PillProps {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "error" | "info";
  className?: string;
}
```

## Usage

```jsx
<Pill tone="accent">WASM</Pill>
```

Rendered from `window.Lingua.Pill` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
