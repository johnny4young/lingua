import { Tooltip, IconButton } from 'lingua';

const Copy = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
);

export const OnIconButton = () => (
  <Tooltip content="Copy output">
    <IconButton tooltip="Copy output"><Copy /></IconButton>
  </Tooltip>
);

export const Sides = () => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
    <Tooltip content="Top" side="top"><IconButton tooltip="Top"><Copy /></IconButton></Tooltip>
    <Tooltip content="Bottom" side="bottom"><IconButton tooltip="Bottom"><Copy /></IconButton></Tooltip>
    <Tooltip content="Left" side="left"><IconButton tooltip="Left"><Copy /></IconButton></Tooltip>
    <Tooltip content="Right" side="right"><IconButton tooltip="Right"><Copy /></IconButton></Tooltip>
  </div>
);
