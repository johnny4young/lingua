import { RuntimeSelector, Kbd } from 'lingua';

const noop = () => {};

export const Idle = () => (
  <RuntimeSelector
    languageLabel="Python"
    modeLabel="WASM"
    onRun={noop}
    runShortcut={<Kbd>⌘↵</Kbd>}
  />
);

export const Running = () => (
  <RuntimeSelector languageLabel="Python" modeLabel="WASM" onRun={noop} running />
);

export const Disabled = () => (
  <RuntimeSelector languageLabel="Rust" modeLabel="Native" onRun={noop} disabled />
);
