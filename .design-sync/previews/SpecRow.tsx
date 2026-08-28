import { SpecCard, SpecRow, StatusBadge, Kbd } from 'lingua';

export const WithDescription = () => (
  <SpecCard>
    <SpecRow
      label="Telemetry"
      description="Anonymous usage counts only — never file contents."
      control={<StatusBadge tone="neutral">Off</StatusBadge>}
      last
    />
  </SpecCard>
);

export const LabelOnly = () => (
  <SpecCard>
    <SpecRow label="Command palette" control={<Kbd>⌘K</Kbd>} last />
  </SpecCard>
);
