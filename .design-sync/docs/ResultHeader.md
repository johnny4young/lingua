---
category: surfaces
---

# ResultHeader

Header strip above a result pane: status text, optional meta, an optional tab row, and a trailing slot for actions.

## Props

```ts
export interface ResultHeaderProps {
  /** Leading status indicator (typically a `<StatusBadge>`). */
  status: React.ReactNode;
  /** Mono metadata line, e.g. "340 ms · 83 B". */
  meta?: string;
  /** Optional tab group, right-aligned. */
  tabs?: readonly ResultHeaderTab[];
  /** Currently-active tab id. */
  activeTab?: string;
  /** Fired with the picked tab id. */
  onTabChange?: (id: string) => void;
  /** Optional far-right slot (e.g. a copy button). */
  trailing?: React.ReactNode;
  className?: string;
}
```

## Usage

```jsx
<ResultHeader
  status={<StatusBadge tone="success" dot>Passed</StatusBadge>}
  meta="in 412ms"
  tabs={[{ id: "out", label: "Output" }, { id: "err", label: "Errors" }]}
  activeTab="out"
  onTabChange={setTab}
/>
```

Rendered from `window.Lingua.ResultHeader` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
