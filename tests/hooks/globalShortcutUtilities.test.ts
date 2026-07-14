import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runUtilityApplyFromInput,
  writeUtilityOutputToClipboard,
} from '@/hooks/globalShortcutUtilities';
import { useUIStore } from '@/stores/uiStore';
import { useUtilityOutputStore } from '@/stores/utilityOutputStore';

describe('global shortcut utility actions', () => {
  beforeEach(() => {
    useUtilityOutputStore.getState().clearProvider();
    useUtilityOutputStore.getState().clearApplyHandler();
    useUIStore.setState({ statusNotice: null });
  });

  it('reports unavailable apply actions without throwing', () => {
    runUtilityApplyFromInput();

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'utilities.toast.applyUnavailable',
    });
  });

  it('runs an enabled utility apply descriptor', () => {
    const run = vi.fn();
    useUtilityOutputStore.getState().setApplyHandler(() => ({
      enabled: true,
      toolNameKey: 'utilities.tool.json.titleLabel',
      run,
    }));

    runUtilityApplyFromInput();

    expect(run).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'success',
      messageKey: 'utilities.toast.applySuccess',
    });
  });

  it('reports empty output without touching the clipboard', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await writeUtilityOutputToClipboard('copy');

    expect(writeText).not.toHaveBeenCalled();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'info',
      messageKey: 'utilities.toast.copyOutputEmpty',
    });
  });
});
