import { Kbd } from 'lingua';

export const Shortcuts = () => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
    <Kbd>⌘K</Kbd>
    <Kbd>⌘↵</Kbd>
    <Kbd>⇧⌘P</Kbd>
    <Kbd>esc</Kbd>
  </div>
);

export const InSentence = () => (
  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-fg-muted)' }}>
    Press <Kbd>⌘K</Kbd> to open the command palette, or <Kbd>esc</Kbd> to dismiss it.
  </p>
);
