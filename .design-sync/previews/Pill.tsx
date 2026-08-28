import { Pill } from 'lingua';

export const Tones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <Pill tone="neutral">Draft</Pill>
    <Pill tone="accent">WASM</Pill>
    <Pill tone="success">Cached</Pill>
    <Pill tone="warning">Deprecated</Pill>
    <Pill tone="error">Blocked</Pill>
    <Pill tone="info">Beta</Pill>
  </div>
);

export const RuntimeLabels = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <Pill tone="accent">Python</Pill>
    <Pill tone="accent">TypeScript</Pill>
    <Pill tone="neutral">Go</Pill>
  </div>
);
