import { StatusBadge } from 'lingua';

export const Tones = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
    <StatusBadge tone="success" dot>Passed</StatusBadge>
    <StatusBadge tone="error" dot>Failed</StatusBadge>
    <StatusBadge tone="warning" dot>Timed out</StatusBadge>
    <StatusBadge tone="info">Queued</StatusBadge>
    <StatusBadge tone="neutral">Idle</StatusBadge>
  </div>
);

export const LicenseTiers = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <StatusBadge tone="free">Free</StatusBadge>
    <StatusBadge tone="pro">Pro</StatusBadge>
  </div>
);

export const SaveState = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <StatusBadge tone="unsaved" dot>Unsaved</StatusBadge>
    <StatusBadge tone="success" dot>Saved</StatusBadge>
  </div>
);
