import { SettingsSection, SpecCard, SpecRow, StatusBadge } from 'lingua';

export const PrivacySection = () => (
  <SettingsSection eyebrow="Privacy" description="What leaves this machine.">
    <SpecCard>
      <SpecRow label="Telemetry" description="Anonymous usage counts only." control={<StatusBadge tone="neutral">Off</StatusBadge>} />
      <SpecRow label="Crash reports" control={<StatusBadge tone="success">On</StatusBadge>} last />
    </SpecCard>
  </SettingsSection>
);
