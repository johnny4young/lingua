import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { held } = vi.hoisted(() => ({ held: { show: null as (() => void) | null } }));

vi.mock('../../src/renderer/stores/sessionStore', () => ({
  armPendingSessionRestoreSnapshot: () => 2,
  holdRestorePrompt: (show: () => void) => {
    held.show = show;
  },
  RESTORE_SESSION_PROMPT_KEY: 'editor.restoreSession.prompt',
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
    held.show = null;
  });

  it('asks to restore with a prompt that waits for an answer', () => {
    useSettingsStore.setState({ restoreSessionMode: 'ask' });
    const { result } = renderHook(() => useSessionRestoreBoot(false));
    expect(result.current).toBe(true);
    // Held until Start says Pick up is not offering the same restore.
    expect(useUIStore.getState().statusNotice).toBeNull();
    held.show?.();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'editor.restoreSession.prompt',
      values: { count: 2 },
      sticky: true,
    });
  });
});
