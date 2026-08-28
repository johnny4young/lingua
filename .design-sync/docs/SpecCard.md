---
category: surfaces
---

# SpecCard

Bordered container that groups SpecRows into one settings card. Rows supply their own hairlines; mark the last one with `last`.

## Props

```ts
export interface SpecCardProps {
  children: React.ReactNode;
  className?: string;
}
```

## Usage

```jsx
<SpecCard>
  <SpecRow label="Theme" control={<ThemeSelect />} />
  <SpecRow label="Font size" control={<Stepper />} last />
</SpecCard>
```

Rendered from `window.Lingua.SpecCard` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
