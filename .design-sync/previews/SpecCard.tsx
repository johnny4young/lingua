import { SpecCard, SpecRow, StatusBadge, Kbd } from 'lingua';

export const SettingsGroup = () => (
  <SpecCard>
    <SpecRow label="Theme" description="Dark is the product default." control={<StatusBadge tone="neutral">Dark</StatusBadge>} />
    <SpecRow label="Editor font size" control={<StatusBadge tone="neutral">13px</StatusBadge>} />
    <SpecRow label="Run shortcut" control={<Kbd>⌘↵</Kbd>} last />
  </SpecCard>
);
