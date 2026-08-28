import { OverlayBackdrop, OverlayCard, Kbd } from 'lingua';

const noop = () => {};

/**
 * OverlayBackdrop moves focus into itself on mount. Give it a real focusable
 * child (as every product surface does) or focus lands on the backdrop root
 * and the card shows a full-width focus ring that no real screen ever shows.
 */
const Palette = ({ placeholder }: { placeholder: string }) => (
  <OverlayCard>
    <input
      defaultValue=""
      placeholder={placeholder}
      style={{
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px 12px',
        border: 'none',
        borderBottom: '1px solid var(--color-border-subtle)',
        background: 'transparent',
        color: 'var(--color-fg-base)',
        font: 'inherit',
        fontSize: 13,
        outline: 'none',
      }}
    />
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {[['Run scratchpad', '⌘↵'], ['Toggle console', '⌘J']].map(([label, key]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', fontSize: 13 }}>
          <span>{label}</span>
          <Kbd>{key}</Kbd>
        </div>
      ))}
    </div>
  </OverlayCard>
);

export const TopAligned = () => (
  <OverlayBackdrop align="top" onClose={noop}>
    <Palette placeholder="Go to file…" />
  </OverlayBackdrop>
);

export const Centered = () => (
  <OverlayBackdrop align="center" onClose={noop}>
    <Palette placeholder="Type a command…" />
  </OverlayBackdrop>
);
