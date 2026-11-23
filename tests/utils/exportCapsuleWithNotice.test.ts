import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportCapsuleWithNotice } from '../../src/renderer/utils/exportCapsule';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

describe('exportCapsuleWithNotice', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a copied capsule as success and a refused clipboard as a warning', async () => {
    const push = vi.spyOn(useUIStore.getState(), 'pushStatusNotice');
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(exportCapsuleWithNotice(FIXTURE_MINIMAL_JS)).resolves.toBe(true);
    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({ tone: 'success', messageKey: 'settings.account.runCapsules.copiedNotice' })
    );

    writeText.mockRejectedValue(new Error('denied'));
    await expect(exportCapsuleWithNotice(FIXTURE_MINIMAL_JS)).resolves.toBe(false);
    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({ tone: 'warning', messageKey: 'results.actions.exportCapsule.clipboardUnavailable' })
    );
  });
});
