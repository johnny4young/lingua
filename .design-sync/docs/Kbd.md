---
category: core
---

# Kbd

Keycap for shortcut hints. Mono, 10.5px, alt-panel surface with a hairline border. Use inside footer legends, tooltips and empty states — never as a button.

## Props

```ts
export interface KbdProps {
  children: React.ReactNode;
  className?: string;
}
```

## Usage

```jsx
<span className="text-body-sm text-fg-muted">Press <Kbd>⌘K</Kbd> to search</span>
```

Rendered from `window.Lingua.Kbd` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
