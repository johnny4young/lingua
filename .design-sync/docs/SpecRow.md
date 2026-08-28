---
category: surfaces
---

# SpecRow

One label/control row inside a SpecCard. `description` adds a supporting line; `searchTargetId` is the anchor Settings search scrolls to.

## Props

```ts
export interface SpecRowProps {
  /** Left-column label. */
  label: React.ReactNode;
  /** Optional supporting line under the label. */
  description?: React.ReactNode;
  /** Right-column control (toggle, select, stepper, value, …). */
  control: React.ReactNode;
  /** When true, drops the bottom hairline (last row in a card). */
  last?: boolean;
  /** Stable target used by Settings search to scroll and focus this row. */
  searchTargetId?: string;
}
```

## Usage

```jsx
<SpecRow
  label="Telemetry"
  description="Anonymous usage counts only."
  control={<Switch />}
/>
```

Rendered from `window.Lingua.SpecRow` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
