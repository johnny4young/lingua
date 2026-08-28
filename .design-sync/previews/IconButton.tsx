import { IconButton } from 'lingua';

const Play = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3" /></svg>
);
const Copy = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);
const Trash = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
);

export const Toolbar = () => (
  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
    <IconButton tooltip="Run"><Play /></IconButton>
    <IconButton tooltip="Copy output"><Copy /></IconButton>
    <IconButton tooltip="Clear" tone="danger"><Trash /></IconButton>
  </div>
);

export const States = () => (
  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
    <IconButton tooltip="Rest"><Copy /></IconButton>
    <IconButton tooltip="Active" active><Copy /></IconButton>
    <IconButton tooltip="Disabled" disabled><Copy /></IconButton>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
    <IconButton tooltip="Small" size="sm"><Copy /></IconButton>
    <IconButton tooltip="Medium" size="md"><Copy /></IconButton>
  </div>
);
