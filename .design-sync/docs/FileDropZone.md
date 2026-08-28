---
category: forms
---

# FileDropZone

Drag-and-drop file target with a click-to-browse fallback. `accept` gates both the drop and the file input; `errorMessage` renders the rejected state inline.

## Props

```ts
export interface FileDropZoneProps {
  /** Called with the dropped or picked file. Async-aware. */
  onFile: (file: File) => Promise<void> | void;
  /** Optional MIME or extension predicate. */
  accept?: (item: File | DataTransferItem) => boolean;
  /** Native file picker `accept` (e.g. ".json,.txt") for the hidden input. */
  acceptAttr?: string;
  /** Hint above the placeholder ("Drop a JSON file..."). */
  hint: React.ReactNode;
  /** Placeholder shown in idle state ("No file selected"). */
  placeholder?: React.ReactNode;
  /** Optional summary node (filename + size) when a file is loaded. */
  summary?: React.ReactNode;
  /** Optional consumer-driven error message to render in error state. */
  errorMessage?: string;
  /** Test id for the dropzone wrapper. */
  testId?: string;
  /** Test id for the hidden file input (assistive picker). */
  inputTestId?: string;
  /** ClassName extension for layout/sizing tweaks. */
  className?: string;
}
```

## Usage

```jsx
<FileDropZone
  hint="Drop a .lingua capsule, or click to browse"
  acceptAttr=".lingua"
  onFile={importCapsule}
/>
```

Rendered from `window.Lingua.FileDropZone` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
