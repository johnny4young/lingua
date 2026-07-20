import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCapsuleToClipboard } from '../../src/renderer/utils/exportCapsule';
import {
  _resetTrustEventCounterForTesting,
  useTrustEventStore,
} from '../../src/renderer/stores/trustEventStore';
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_LICENSE_LEAK_PROBE,
} from '../shared/runCapsule.fixtures';

/**
 * implementation note — capsule export records a metadata-only trust
 * event in the local log so the Privacy dashboard can surface a real
 * "last call". `trackEvent` is a no-op in tests (no consent / endpoint),
 * so the only event recorded is the capsule-export one.
 */
describe('exportCapsuleToClipboard — trust capture ', () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    _resetTrustEventCounterForTesting();
    useTrustEventStore.getState().clear();
    writeText.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records a metadata-only capsule-export event on a successful clipboard write', async () => {
    const result = await exportCapsuleToClipboard(FIXTURE_MINIMAL_JS, 'settings-export');
    expect(result.ok).toBe(true);
    const events = useTrustEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      feature: 'capsule-export',
      action: 'exported',
      sensitivity: 'medium',
    });
    // Metadata-only shape: "<language> capsule exported (<sizeBucket>)".
    expect(events[0]!.summary).toMatch(/^\S+ capsule exported \(.+\)$/);
    expect(events[0]!.summary).toContain(FIXTURE_MINIMAL_JS.tab.language);
  });

  it('does NOT record when the clipboard write fails (nothing left the app)', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const result = await exportCapsuleToClipboard(FIXTURE_MINIMAL_JS, 'settings-export');
    expect(result.ok).toBe(false);
    expect(useTrustEventStore.getState().events).toHaveLength(0);
  });

  it('still reports clipboard success when trust capture storage fails', async () => {
    const recordSpy = vi
      .spyOn(useTrustEventStore.getState(), 'record')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    const result = await exportCapsuleToClipboard(FIXTURE_MINIMAL_JS, 'settings-export');
    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
  });

  it('never leaks capsule code/content into the trust summary (privacy invariant)', async () => {
    await exportCapsuleToClipboard(FIXTURE_LICENSE_LEAK_PROBE, 'settings-export');
    const summary = useTrustEventStore.getState().events[0]?.summary ?? '';
    // The probe carries sensitive-looking code/output; the summary is
    // strictly metadata, so none of the capsule body appears in it.
    expect(summary).toMatch(/^\S+ capsule exported \(.+\)$/);
    expect(summary).not.toContain(FIXTURE_LICENSE_LEAK_PROBE.tab.content);
  });
});
