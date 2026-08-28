---
category: feedback
---

# ConfirmDialog

Blocking two-choice confirmation. Both labels are required so the buttons never read as a generic Yes/No. Use only for destructive or irreversible actions.

## Props

```ts
export interface ConfirmDialogProps {
  /** Translated dialog title; wired to `aria-labelledby`. */
  title: string;
  /** Translated body copy describing the consequence of confirming; wired to `aria-describedby`. A `ReactNode` is accepted so */
  body: React.ReactNode;
  /** Translated label for the danger-styled confirm button. */
  confirmLabel: string;
  /** Translated label for the safe cancel button (receives initial focus). */
  cancelLabel: string;
  /** Invoked when the user confirms the destructive action. */
  onConfirm: () => void;
  /** Invoked on Cancel, Escape, or scrim click. */
  onCancel: () => void;
  /** Optional `data-testid` applied to the dialog surface. The confirm / cancel buttons derive their own testids from it (`-c */
  testId?: string;
}
```

## Usage

```jsx
<ConfirmDialog
  title="Discard changes?"
  body="This scratchpad has unsaved edits."
  confirmLabel="Discard"
  cancelLabel="Keep editing"
  onConfirm={discard}
  onCancel={close}
/>
```

Rendered from `window.Lingua.ConfirmDialog` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
