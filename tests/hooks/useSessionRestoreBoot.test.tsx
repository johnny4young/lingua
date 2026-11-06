import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/renderer/stores/sessionStore', () => ({
  armPendingSessionRestoreSnapshot: () => 2,
  useSessionStore: { getState: () => ({ savedTabs: [], restoreSession: vi.fn() }) },
}));

import { useSessionRestoreBoot } from '../../src/renderer/hooks/useSessionRestoreBoot';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const initialSettings = useSettingsStore.getState();

describe('useSessionRestoreBoot', () => {
  afterEach(() => {
    useSettingsStore.setState(initialSettings, true);
    useUIStore.setState({ statusNotice: null, statusNoticeQueue: [] });
  });

  it('asks to restore with a prompt that waits for an answer', () => {
    useSettingsStore.setState({ restoreSessionMode: 'ask' });
    const { result } = renderHook(() => useSessionRestoreBoot(false));
    expect(result.current).toBe(true);
    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'editor.restoreSession.prompt',
      values: { count: 2 },
      sticky: true,
    });
  });
});
