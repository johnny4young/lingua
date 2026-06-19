import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetSqlStorageModeTelemetryForTests,
  trackSqlStorageMode,
} from '../../../src/renderer/hooks/sqlWorkspaceTelemetry';
import { trackEvent } from '../../../src/renderer/utils/telemetry';

vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

const trackEventMock = trackEvent as unknown as ReturnType<typeof vi.fn>;

describe('sqlWorkspaceTelemetry', () => {
  beforeEach(() => {
    __resetSqlStorageModeTelemetryForTests();
    trackEventMock.mockClear();
  });

  it('dedupes repeated storage-mode telemetry for the same resolved/requested pair', () => {
    trackSqlStorageMode('memory', 'memory');
    trackSqlStorageMode('memory', 'memory');
    trackSqlStorageMode('memory', 'opfs');

    expect(trackEventMock).toHaveBeenCalledTimes(2);
    expect(trackEventMock).toHaveBeenNthCalledWith(1, 'sql.storage_mode', {
      mode: 'memory',
      requested: 'memory',
    });
    expect(trackEventMock).toHaveBeenNthCalledWith(2, 'sql.storage_mode', {
      mode: 'memory',
      requested: 'opfs',
    });
  });
});
