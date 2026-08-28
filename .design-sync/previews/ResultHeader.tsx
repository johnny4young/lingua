import { ResultHeader, StatusBadge, MonoBadge } from 'lingua';

const noop = () => {};

export const WithTabs = () => (
  <ResultHeader
    status={<StatusBadge tone="success" dot>Passed</StatusBadge>}
    meta="in 412ms"
    tabs={[{ id: 'out', label: 'Output' }, { id: 'err', label: 'Errors' }, { id: 'raw', label: 'Raw' }]}
    activeTab="out"
    onTabChange={noop}
  />
);

export const FailedRun = () => (
  <ResultHeader
    status={<StatusBadge tone="error" dot>Failed</StatusBadge>}
    meta="in 88ms"
    trailing={<MonoBadge tone="error">exit 1</MonoBadge>}
  />
);
