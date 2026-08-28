import { Eyebrow } from 'lingua';

export const SectionLabel = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <Eyebrow>Appearance</Eyebrow>
    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-fg-muted)' }}>
      Theme, editor font, and density.
    </p>
  </div>
);

export const Stacked = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <Eyebrow>Privacy</Eyebrow>
    <Eyebrow>Runtimes</Eyebrow>
    <Eyebrow>Keyboard</Eyebrow>
  </div>
);
