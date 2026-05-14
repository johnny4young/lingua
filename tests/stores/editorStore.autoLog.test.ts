/**
 * RL-020 Slice 5 fold C — per-tab `autoLogEnabled` override.
 *
 * Covers:
 *   - `setTabAutoLogEnabled(true | false)` writes the override.
 *   - `setTabAutoLogEnabled(null)` clears the override so the tab
 *     falls back to the per-language Settings default.
 *   - The setter refuses non-JS/TS tabs (auto-log is JS/TS-only).
 *   - Add/restore sanitize stale non-JS/TS overrides.
 *   - `renameTab` away from JS / TS clears any persisted override
 *     so a stale flag does not influence the new language.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

import { useEditorStore } from '@/stores/editorStore';
import { useLicenseStore } from '@/stores/licenseStore';

function setActiveProLicense(): void {
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

describe('editorStore — autoLogEnabled per-tab override (RL-020 Slice 5)', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    setActiveProLicense();
  });

  it('writes the per-tab override', () => {
    const { addTab, setTabAutoLogEnabled } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    setTabAutoLogEnabled('t1', true);
    expect(useEditorStore.getState().tabs[0]?.autoLogEnabled).toBe(true);
    setTabAutoLogEnabled('t1', false);
    expect(useEditorStore.getState().tabs[0]?.autoLogEnabled).toBe(false);
  });

  it('emits runtime.auto_log_enabled telemetry on every per-tab flip (true + false), but not on the null clear', () => {
    const { addTab, setTabAutoLogEnabled } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    mockTrackEvent.mockClear();
    setTabAutoLogEnabled('t1', true);
    expect(mockTrackEvent).toHaveBeenCalledWith('runtime.auto_log_enabled', {
      language: 'javascript',
      enabled: true,
    });
    setTabAutoLogEnabled('t1', false);
    expect(mockTrackEvent).toHaveBeenLastCalledWith('runtime.auto_log_enabled', {
      language: 'javascript',
      enabled: false,
    });
    mockTrackEvent.mockClear();
    setTabAutoLogEnabled('t1', null);
    // The clear path resolves to the per-language default; no
    // single boolean to report, so no emission.
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('clearing with null removes the override', () => {
    const { addTab, setTabAutoLogEnabled } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.ts', language: 'typescript', content: '' });
    setTabAutoLogEnabled('t1', true);
    expect(useEditorStore.getState().tabs[0]?.autoLogEnabled).toBe(true);
    setTabAutoLogEnabled('t1', null);
    expect(useEditorStore.getState().tabs[0]).not.toHaveProperty('autoLogEnabled');
  });

  it('refuses non-JS/TS languages', () => {
    const { addTab, setTabAutoLogEnabled } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.py', language: 'python', content: '' });
    setTabAutoLogEnabled('t1', true);
    expect(useEditorStore.getState().tabs[0]?.autoLogEnabled).toBeUndefined();
  });

  it('drops stale non-JS/TS overrides passed through addTab', () => {
    const { addTab } = useEditorStore.getState();
    addTab({
      id: 't1',
      name: 'main.py',
      language: 'python',
      content: '',
      autoLogEnabled: true,
    });
    expect(useEditorStore.getState().tabs[0]).not.toHaveProperty('autoLogEnabled');
  });

  it('drops stale non-JS/TS overrides during session restore', () => {
    useEditorStore.getState().restoreTabs(
      [
        {
          id: 't1',
          name: 'main.py',
          language: 'python',
          content: '',
          autoLogEnabled: true,
        },
      ],
      't1'
    );
    expect(useEditorStore.getState().tabs[0]).not.toHaveProperty('autoLogEnabled');
  });

  it('renameTab from JS to Python clears any persisted override', () => {
    const { addTab, setTabAutoLogEnabled, renameTab } =
      useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    setTabAutoLogEnabled('t1', true);
    renameTab('t1', 'main.py');
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.language).toBe('python');
    expect(tab?.autoLogEnabled).toBeUndefined();
  });

  it('renameTab inside the JS/TS pair preserves the override', () => {
    const { addTab, setTabAutoLogEnabled, renameTab } =
      useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    setTabAutoLogEnabled('t1', true);
    renameTab('t1', 'main.ts');
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.language).toBe('typescript');
    expect(tab?.autoLogEnabled).toBe(true);
  });
});
