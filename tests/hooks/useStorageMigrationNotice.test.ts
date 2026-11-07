import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorageMigrationNotice } from '@/hooks/useStorageMigrationNotice';
import { useUIStore } from '@/stores/uiStore';

let pushSpy: ReturnType<typeof vi.fn>;
const initialUIState = useUIStore.getState();
const originalLingua = window.lingua;

function mount(notice: 'retry' | 'final' | null) {
  const consume = vi.fn(async () => notice);
  Object.assign(window, { lingua: { ...originalLingua, consumeStorageMigrationNotice: consume } });
  renderHook(() => useStorageMigrationNotice());
  return consume;
}

beforeEach(() => {
  pushSpy = vi.fn();
  useUIStore.setState({ statusNotice: null, pushStatusNotice: pushSpy });
});

afterEach(() => {
  useUIStore.setState(initialUIState, true);
  Object.assign(window, { lingua: originalLingua });
});

describe('useStorageMigrationNotice', () => {
  it('says a failed copy will be retried', async () => {
    mount('retry');
    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    expect(pushSpy).toHaveBeenCalledWith({
      tone: 'warning',
      messageKey: 'startup.storageMigration.retry',
      sticky: false,
    });
  });

  it('keeps the notice on screen once the copy gave up', async () => {
    mount('final');
    await waitFor(() =>
      expect(pushSpy).toHaveBeenCalledWith({
        tone: 'warning',
        messageKey: 'startup.storageMigration.final',
        sticky: true,
      })
    );
  });

  it('shows nothing when there is nothing to report', async () => {
    const consume = mount(null);
    await waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
