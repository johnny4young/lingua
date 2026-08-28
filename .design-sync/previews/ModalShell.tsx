import { ModalShell, ModalFooterLegend, Kbd, SpecCard, SpecRow } from 'lingua';

const noop = () => {};

export const ShortcutsModal = () => (
  <ModalShell header="Keyboard shortcuts" onClose={noop} footerLegend={<ModalFooterLegend navigate close />}>
    <SpecCard>
      <SpecRow label="Run scratchpad" control={<Kbd>⌘↵</Kbd>} />
      <SpecRow label="Command palette" control={<Kbd>⌘K</Kbd>} />
      <SpecRow label="Quick open" control={<Kbd>⌘P</Kbd>} last />
    </SpecCard>
  </ModalShell>
);

export const WithDescription = () => (
  <ModalShell
    header="Import capsule"
    onClose={noop}
    footerLegend={<ModalFooterLegend select close />}
  >
    <p style={{ margin: 0 }}>
      A capsule bundles the scratchpad, its runtime and every dependency so a run
      reproduces exactly on another machine.
    </p>
  </ModalShell>
);
