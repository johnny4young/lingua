import { TypePill } from 'lingua';

export const Kinds = () => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
    <TypePill kind="string" />
    <TypePill kind="number" />
    <TypePill kind="boolean" />
    <TypePill kind="object" />
    <TypePill kind="array" />
    <TypePill kind="null" />
    <TypePill kind="undefined" />
    <TypePill kind="function" />
  </div>
);
