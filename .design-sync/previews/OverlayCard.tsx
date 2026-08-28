import { OverlayCard, Kbd } from 'lingua';

export const CommandPalette = () => (
  <OverlayCard>
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border-subtle)', fontSize: 13, color: 'var(--color-fg-subtle)' }}>
      Type a command…
    </div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {[['Run scratchpad', '⌘↵'], ['Toggle console', '⌘J'], ['Open settings', '⌘,']].map(([label, key]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', fontSize: 13 }}>
          <span>{label}</span>
          <Kbd>{key}</Kbd>
        </div>
      ))}
    </div>
  </OverlayCard>
);
