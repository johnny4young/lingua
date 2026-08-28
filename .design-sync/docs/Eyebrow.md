---
category: core
---

# Eyebrow

Uppercase tracked label that titles a section. 10.5px / 0.16em tracking. Sits above a heading or opens a settings group — never used as body copy.

## Props

```ts
export interface EyebrowProps {
  children: React.ReactNode;
  className?: string;
}
```

## Usage

```jsx
<Eyebrow>Appearance</Eyebrow>
```

Rendered from `window.Lingua.Eyebrow` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
