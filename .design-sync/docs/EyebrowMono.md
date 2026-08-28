---
category: core
---

# EyebrowMono

Monospace eyebrow for machine-shaped section labels — file paths, runtime names, capability ids.

## Props

```ts
export interface EyebrowMonoProps {
  children: React.ReactNode;
  className?: string;
}
```

## Usage

```jsx
<EyebrowMono>python · 3.12</EyebrowMono>
```

Rendered from `window.Lingua.EyebrowMono` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
