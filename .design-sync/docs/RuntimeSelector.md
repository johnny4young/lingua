---
category: forms
---

# RuntimeSelector

The workbench run control: language picker, mode picker and the Run/Stop button in one strip. `running` swaps Run for Stop. This is the only place green is used as a fill.

## Props

```ts
export interface RuntimeSelectorProps {
  languageLabel: React.ReactNode;
  languageGlyph?: RuntimeLanguageGlyph;
  onPickLanguage?: () => void;
  modeLabel: React.ReactNode;
  onPickMode?: () => void;
  onRun: () => void;
  running?: boolean;
  /** Run-segment label (i18n copy from the caller). Optional so the primitive never hardcodes a string; when omitted the play */
  runLabel?: React.ReactNode;
  /** Label shown while `running` (i18n copy). Falls back to `runLabel`. */
  stopLabel?: React.ReactNode;
  /** Optional keycap shown on the run segment when idle, e.g. "⌘↵". */
  runShortcut?: React.ReactNode;
  disabled?: boolean;
}
```

## Usage

```jsx
<RuntimeSelector
  languageLabel="Python"
  modeLabel="WASM"
  runShortcut={<Kbd>⌘↵</Kbd>}
  onRun={run}
/>
```

Rendered from `window.Lingua.RuntimeSelector` — the bundle is loaded from the project root `_ds_bundle.js`, and the token layer arrives through `styles.css`.
