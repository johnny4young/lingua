/**
 * RL-019 Slice 1 — `runtimeMode` extension to FileTab + editorStore.
 *
 * Covers:
 *   - `createDefaultTab` defaults to `worker` for JS/TS, undefined
 *     otherwise.
 *   - `setTabRuntimeMode` action: enforces JS/TS guard, rejects
 *     unimplemented modes with a status notice, fires telemetry on
 *     a successful change, no-op on same-mode write.
 *   - `restoreTabs` backfills missing `runtimeMode` for JS/TS tabs
 *     (so a pre-Slice-1 session restores cleanly).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

import { useEditorStore, createDefaultTab } from '@/stores/editorStore';
import { useUIStore } from '@/stores/uiStore';
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

describe('editorStore — runtimeMode (RL-019 Slice 1)', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({
      statusNotice: null,
      activeBottomPanel: 'console',
      consoleVisible: false,
    });
    setActiveProLicense();
  });

  it('createDefaultTab seeds worker for JS', () => {
    const tab = createDefaultTab('javascript');
    expect(tab.runtimeMode).toBe('worker');
  });

  it('createDefaultTab seeds worker for TS', () => {
    const tab = createDefaultTab('typescript');
    expect(tab.runtimeMode).toBe('worker');
  });

  it('createDefaultTab leaves runtimeMode undefined for non-JS/TS', () => {
    const python = createDefaultTab('python');
    const go = createDefaultTab('go');
    const rust = createDefaultTab('rust');
    expect(python.runtimeMode).toBeUndefined();
    expect(go.runtimeMode).toBeUndefined();
    expect(rust.runtimeMode).toBeUndefined();
  });

  it('addTab backfills runtimeMode when caller forgot for JS/TS', () => {
    const { addTab } = useEditorStore.getState();
    addTab({
      id: 'manual-1',
      name: 'manual.js',
      language: 'javascript',
      content: '',
    });
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.runtimeMode).toBe('worker');
  });

  it('addTab coerces unimplemented runtimeMode values for JS/TS', () => {
    const { addTab } = useEditorStore.getState();
    addTab({
      id: 'manual-node',
      name: 'manual.js',
      language: 'javascript',
      content: '',
      runtimeMode: 'node',
    });
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.runtimeMode).toBe('worker');
  });

  it('setTabRuntimeMode is a no-op for non-JS/TS tabs', () => {
    const { addTab, setTabRuntimeMode } = useEditorStore.getState();
    const py = createDefaultTab('python');
    addTab(py);
    setTabRuntimeMode(py.id, 'worker');
    const tab = useEditorStore.getState().tabs.find((t) => t.id === py.id);
    expect(tab?.runtimeMode).toBeUndefined();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('setTabRuntimeMode rejects unimplemented modes and pushes a status notice', () => {
    const { addTab, setTabRuntimeMode } = useEditorStore.getState();
    const js = createDefaultTab('javascript');
    addTab(js);
    setTabRuntimeMode(js.id, 'node');
    const tab = useEditorStore.getState().tabs.find((t) => t.id === js.id);
    expect(tab?.runtimeMode).toBe('worker');
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('runtimeMode.notice.notImplementedNode');
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('setTabRuntimeMode accepts browser-preview after Slice 3 and fires telemetry', () => {
    // RL-019 Slice 3 — browser-preview is implemented now. The
    // reject branch + notice only applies to `node` until Slice 2.
    const { addTab, setTabRuntimeMode } = useEditorStore.getState();
    const ts = createDefaultTab('typescript');
    addTab(ts);
    setTabRuntimeMode(ts.id, 'browser-preview');
    const tab = useEditorStore.getState().tabs.find((t) => t.id === ts.id);
    expect(tab?.runtimeMode).toBe('browser-preview');
    expect(useUIStore.getState().activeBottomPanel).toBe('browser-preview');
    expect(useUIStore.getState().consoleVisible).toBe(true);
    expect(mockTrackEvent).toHaveBeenCalledWith('runtime.mode_changed', {
      mode: 'browser-preview',
      language: 'typescript',
    });
  });

  it('setTabRuntimeMode returns to the console panel when switching back to Worker', () => {
    const { addTab, setTabRuntimeMode } = useEditorStore.getState();
    const js = createDefaultTab('javascript');
    addTab({ ...js, runtimeMode: 'browser-preview' });
    useUIStore.setState({ activeBottomPanel: 'browser-preview', consoleVisible: true });

    setTabRuntimeMode(js.id, 'worker');

    const tab = useEditorStore.getState().tabs.find((t) => t.id === js.id);
    expect(tab?.runtimeMode).toBe('worker');
    expect(useUIStore.getState().activeBottomPanel).toBe('console');
    expect(useUIStore.getState().consoleVisible).toBe(true);
  });

  it('setTabRuntimeMode is a no-op when the mode is already current (no telemetry)', () => {
    const { addTab, setTabRuntimeMode } = useEditorStore.getState();
    const js = createDefaultTab('javascript');
    addTab(js);
    setTabRuntimeMode(js.id, 'worker');
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('restoreTabs backfills missing runtimeMode for JS/TS', () => {
    const { restoreTabs } = useEditorStore.getState();
    restoreTabs([
      {
        id: 'restored-1',
        name: 'old.js',
        language: 'javascript',
        content: '',
        // No runtimeMode field — simulating a pre-Slice-1 session.
      },
      {
        id: 'restored-2',
        name: 'sym.py',
        language: 'python',
        content: '',
      },
    ]);
    const tabs = useEditorStore.getState().tabs;
    const js = tabs.find((t) => t.id === 'restored-1');
    const py = tabs.find((t) => t.id === 'restored-2');
    expect(js?.runtimeMode).toBe('worker');
    expect(py?.runtimeMode).toBeUndefined();
  });

  it('restoreTabs clears stale runtimeMode fields for non-JS/TS tabs', () => {
    const { restoreTabs } = useEditorStore.getState();
    restoreTabs([
      {
        id: 'restored-python',
        name: 'old.py',
        language: 'python',
        content: '',
        runtimeMode: 'worker',
      },
    ]);
    const py = useEditorStore.getState().tabs[0];
    expect(py?.runtimeMode).toBeUndefined();
  });

  it('renameTab keeps runtimeMode aligned with the renamed language', () => {
    const { addTab, renameTab } = useEditorStore.getState();
    const js = createDefaultTab('javascript');
    addTab(js);

    renameTab(js.id, 'renamed.py');
    const renamedPython = useEditorStore.getState().tabs.find((t) => t.id === js.id);
    expect(renamedPython?.language).toBe('python');
    expect(renamedPython?.runtimeMode).toBeUndefined();

    renameTab(js.id, 'renamed.ts');
    const renamedTypescript = useEditorStore.getState().tabs.find((t) => t.id === js.id);
    expect(renamedTypescript?.language).toBe('typescript');
    expect(renamedTypescript?.runtimeMode).toBe('worker');
  });
});
