import { EyebrowMono } from 'lingua';

export const RuntimeLabel = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <EyebrowMono>python · 3.12</EyebrowMono>
    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-fg-muted)' }}>
      Resolved from the capsule manifest.
    </p>
  </div>
);

export const Paths = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <EyebrowMono>src/renderer/index.css</EyebrowMono>
    <EyebrowMono>capsule://scratchpad.lingua</EyebrowMono>
  </div>
);
