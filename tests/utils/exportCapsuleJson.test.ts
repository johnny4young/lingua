import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCapsuleJsonToFile } from '../../src/renderer/utils/exportCapsuleJson';
import { saveOrDownloadTextFile } from '../../src/renderer/utils/saveTextFileToDisk';
import { parseRunCapsule } from '../../src/shared/runCapsule';
import {
  _resetTrustEventCounterForTesting,
  useTrustEventStore,
} from '../../src/renderer/stores/trustEventStore';
import { FIXTURE_LICENSE_LEAK_PROBE, FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

vi.mock('../../src/renderer/utils/saveTextFileToDisk', () => ({
  saveOrDownloadTextFile: vi.fn(),
}));

const save = vi.mocked(saveOrDownloadTextFile);

beforeEach(() => {
  _resetTrustEventCounterForTesting();
  useTrustEventStore.getState().clear();
  save.mockReset().mockResolvedValue(undefined);
});

describe('exportCapsuleJsonToFile', () => {
  it('saves a standalone RunCapsuleV1 with a stable, non-sensitive filename', async () => {
    const onOk = vi.fn();
    save.mockImplementation(async (_body, _name, _mime, handlers) => handlers.onOk());

    await exportCapsuleJsonToFile(FIXTURE_MINIMAL_JS, { onOk, onError: vi.fn() });

    expect(save).toHaveBeenCalledOnce();
    const [body, name, mime] = save.mock.calls[0]!;
    expect(name).toBe('lingua-run.capsule.json');
    expect(mime).toBe('application/json;charset=utf-8');
    const parsed = parseRunCapsule(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(FIXTURE_MINIMAL_JS);
    expect(onOk).toHaveBeenCalledOnce();
  });

  it('records a metadata-only trust event only after a successful save', async () => {
    save.mockImplementation(async (_body, _name, _mime, handlers) => handlers.onOk());
    await exportCapsuleJsonToFile(FIXTURE_LICENSE_LEAK_PROBE, {
      onOk: vi.fn(), onError: vi.fn(),
    });
    const events = useTrustEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ feature: 'capsule-export', action: 'exported' });
    expect(events[0]!.summary).not.toContain(FIXTURE_LICENSE_LEAK_PROBE.tab.content);
    expect(events[0]!.summary).not.toContain(FIXTURE_LICENSE_LEAK_PROBE.source.content);
  });

  it('does not claim export on error or native dialog cancellation', async () => {
    const onOk = vi.fn();
    const onError = vi.fn();
    save.mockImplementationOnce(async (_body, _name, _mime, handlers) => handlers.onError());
    await exportCapsuleJsonToFile(FIXTURE_MINIMAL_JS, { onOk, onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(onOk).not.toHaveBeenCalled();
    expect(useTrustEventStore.getState().events).toHaveLength(0);

    save.mockImplementationOnce(async () => undefined);
    await exportCapsuleJsonToFile(FIXTURE_MINIMAL_JS, { onOk, onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(onOk).not.toHaveBeenCalled();
    expect(useTrustEventStore.getState().events).toHaveLength(0);
  });

  it('rejects a file the CLI could not validate or replay before opening a save destination', async () => {
    const onError = vi.fn();
    await exportCapsuleJsonToFile({
      ...FIXTURE_MINIMAL_JS,
      source: { ...FIXTURE_MINIMAL_JS.source, content: 'console.log("altered")' },
    }, { onOk: vi.fn(), onError });
    expect(onError).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();

    await exportCapsuleJsonToFile({
      ...FIXTURE_MINIMAL_JS,
      source: { ...FIXTURE_MINIMAL_JS.source, content: 'x'.repeat(4_194_304) },
    }, { onOk: vi.fn(), onError });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });
});
