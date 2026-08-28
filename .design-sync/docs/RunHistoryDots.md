---
category: feedback
---

# RunHistoryDots

Compact run-history strip: one dot per recent run, colored by outcome. Reads left-to-right, oldest first.

## Props

```ts
export interface RunHistoryDotsProps {
  history: readonly RunHistoryEntry[];
  className?: string;
}
```

## Usage

```jsx
<RunHistoryDots history={recentRuns} />
```

Rendered from `window.Lingua.RunHistoryDots` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
