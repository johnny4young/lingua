import { RunHistoryDots } from 'lingua';

export const MixedRuns = () => (
  <RunHistoryDots
    history={[
      { status: 'ok', ms: 312 },
      { status: 'ok', ms: 288 },
      { status: 'err' },
      { status: 'ok', ms: 401 },
      { status: 'pending' },
    ]}
  />
);

export const AllPassing = () => (
  <RunHistoryDots
    history={[
      { status: 'ok', ms: 120 },
      { status: 'ok', ms: 118 },
      { status: 'ok', ms: 131 },
      { status: 'ok', ms: 127 },
    ]}
  />
);
