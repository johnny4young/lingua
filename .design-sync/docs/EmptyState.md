---
category: feedback
---

# EmptyState

Centered icon + title + optional description and action, for a panel with nothing in it yet. The icon is a stroke-based Lucide glyph, never an emoji.

## Props

```ts
export interface EmptyStateProps {
  /** Glyph rendered inside the accent tile (e.g. a lucide icon). */
  icon: React.ReactNode;
  title: React.ReactNode;
  /** Optional supporting line. Omit (or pass null) for a title-only state. */
  description?: React.ReactNode;
  /** Optional CTA row beneath the description. */
  action?: React.ReactNode;
  className?: string;
}
```

## Usage

```jsx
<EmptyState
  icon={<FileText size={24} strokeWidth={1.5} />}
  title="No results yet"
  description="Run the query to see rows here."
/>
```

Rendered from `window.Lingua.EmptyState` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
