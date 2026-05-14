/**
 * RL-020 Slice 2 — `workflowMode` extension to FileTab + editorStore.
 *
 * Covers:
 *   - `createDefaultTab` resolves workflow mode by language defaults.
 *   - `addTab` backfills missing `workflowMode`.
 *   - `setTabWorkflowMode` validates language support, fires
 *     `runtime.workflow_mode_changed` with `trigger: 'toolbar'`,
 *     no-ops on same-mode write.
 *   - `renameTab` auto-corrects an unsupported mode after a language
 *     change and emits telemetry with `trigger: 'language_change'`.
 *   - `restoreTabs` backfills missing `workflowMode` for pre-Slice-2
 *     sessions; snaps tampered values back to a supported default.
 *   - Per-language settings default seeds new tabs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

import { useEditorStore, createDefaultTab } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
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

function resetSettingsWorkflowDefaults(): void {
  useSettingsStore.setState({
    workflowModeDefaultsByLanguage: {
      javascript: 'scratchpad',
      typescript: 'scratchpad',
      python: 'scratchpad',
    },
    firstWorkflowModeSwitchAcknowledged: false,
  });
}

describe('editorStore — workflowMode (RL-020 Slice 2)', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useUIStore.setState({
      statusNotice: null,
      activeBottomPanel: 'console',
      consoleVisible: false,
    });
    resetSettingsWorkflowDefaults();
    setActiveProLicense();
  });

  describe('createDefaultTab', () => {
    it('seeds scratchpad for JS / TS / Python', () => {
      expect(createDefaultTab('javascript').workflowMode).toBe('scratchpad');
      expect(createDefaultTab('typescript').workflowMode).toBe('scratchpad');
      expect(createDefaultTab('python').workflowMode).toBe('scratchpad');
    });
    it('seeds run for validate / view-only languages', () => {
      expect(createDefaultTab('json').workflowMode).toBe('run');
    });
    it('seeds scratchpad for Go / Rust (auto-run desktop runners)', () => {
      expect(createDefaultTab('go').workflowMode).toBe('scratchpad');
      expect(createDefaultTab('rust').workflowMode).toBe('scratchpad');
    });
    it('honours a per-language Settings override', () => {
      useSettingsStore.setState({
        workflowModeDefaultsByLanguage: { javascript: 'run' },
      });
      expect(createDefaultTab('javascript').workflowMode).toBe('run');
    });
    it('falls back to the shared helper when the Settings override is invalid', () => {
      useSettingsStore.setState({
        // `debug` on Python is not supported; the coerce step should
        // ignore the bad override and use the shared default.
        workflowModeDefaultsByLanguage: { python: 'debug' as never },
      });
      expect(createDefaultTab('python').workflowMode).toBe('scratchpad');
    });
  });

  describe('addTab', () => {
    it('backfills workflowMode when caller forgot', () => {
      const { addTab } = useEditorStore.getState();
      addTab({
        id: 'manual-1',
        name: 'manual.js',
        language: 'javascript',
        content: '',
      });
      const tab = useEditorStore.getState().tabs[0];
      expect(tab?.workflowMode).toBe('scratchpad');
    });
    it('coerces an unsupported explicit workflowMode', () => {
      const { addTab } = useEditorStore.getState();
      addTab({
        id: 'manual-bad',
        name: 'manual.rs',
        language: 'rust',
        content: '',
        // Rust does not support debug — coerce snaps to the Rust
        // default (scratchpad, since Rust has an auto-run runner
        // on desktop).
        workflowMode: 'debug' as never,
      });
      const tab = useEditorStore.getState().tabs[0];
      expect(tab?.workflowMode).toBe('scratchpad');
    });
  });

  describe('setTabWorkflowMode', () => {
    it('flips the workflow mode and emits toolbar-sourced telemetry', () => {
      const { addTab, setTabWorkflowMode } = useEditorStore.getState();
      addTab({
        id: 't1',
        name: 'main.js',
        language: 'javascript',
        content: '',
      });
      setTabWorkflowMode('t1', 'debug');
      const tab = useEditorStore.getState().tabs.find((t) => t.id === 't1');
      expect(tab?.workflowMode).toBe('debug');
      expect(mockTrackEvent).toHaveBeenCalledWith('runtime.workflow_mode_changed', {
        language: 'javascript',
        from: 'scratchpad',
        to: 'debug',
        trigger: 'toolbar',
      });
    });

    it('surfaces the one-shot first-switch notice from every setter entry point', () => {
      const { addTab, setTabWorkflowMode } = useEditorStore.getState();
      addTab({
        id: 't1',
        name: 'main.js',
        language: 'javascript',
        content: '',
      });

      setTabWorkflowMode('t1', 'run');

      expect(useUIStore.getState().statusNotice).toMatchObject({
        tone: 'info',
        messageKey: 'workflowMode.firstSwitch.notice',
      });
      expect(
        useSettingsStore.getState().firstWorkflowModeSwitchAcknowledged
      ).toBe(true);

      useUIStore.setState({ statusNotice: null });
      setTabWorkflowMode('t1', 'scratchpad');
      setTabWorkflowMode('t1', 'run');

      expect(useUIStore.getState().statusNotice).toBeNull();
    });

    it('no-ops (no telemetry) when the mode is unchanged', () => {
      const { addTab, setTabWorkflowMode } = useEditorStore.getState();
      addTab({
        id: 't1',
        name: 'main.js',
        language: 'javascript',
        content: '',
      });
      setTabWorkflowMode('t1', 'scratchpad');
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });

    it('refuses an unsupported mode for the language (no state, no telemetry)', () => {
      const { addTab, setTabWorkflowMode } = useEditorStore.getState();
      addTab({
        id: 't1',
        name: 'main.rs',
        language: 'rust',
        content: '',
      });
      // Rust doesn't support debug — the setter must reject silently.
      // The seeded scratchpad mode stays in place.
      setTabWorkflowMode('t1', 'debug');
      const tab = useEditorStore.getState().tabs.find((t) => t.id === 't1');
      expect(tab?.workflowMode).toBe('scratchpad');
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });

    it('refuses a write to a tab that does not exist', () => {
      const { setTabWorkflowMode } = useEditorStore.getState();
      setTabWorkflowMode('missing-tab', 'debug');
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });
  });

  describe('renameTab — fold D auto-correction', () => {
    it('emits language_change telemetry when the new language no longer supports the mode', () => {
      const { addTab, setTabWorkflowMode, renameTab } = useEditorStore.getState();
      addTab({
        id: 't1',
        name: 'main.js',
        language: 'javascript',
        content: '',
      });
      // Explicit choice: Debug on JS.
      setTabWorkflowMode('t1', 'debug');
      mockTrackEvent.mockClear();
      // Rename to .json — JSON only supports `run`, so the rename
      // handler auto-corrects from `debug` → `run` and emits
      // language_change.
      renameTab('t1', 'data.json');
      const tab = useEditorStore.getState().tabs.find((t) => t.id === 't1');
      expect(tab?.language).toBe('json');
      expect(tab?.workflowMode).toBe('run');
      expect(mockTrackEvent).toHaveBeenCalledWith('runtime.workflow_mode_changed', {
        language: 'json',
        from: 'debug',
        to: 'run',
        trigger: 'language_change',
      });
    });

    it('does NOT emit when the mode is still supported by the new language', () => {
      const { addTab, renameTab } = useEditorStore.getState();
      addTab({
        id: 't1',
        name: 'main.js',
        language: 'javascript',
        content: '',
      });
      mockTrackEvent.mockClear();
      // JS → TS: scratchpad supported both ways. No auto-correction.
      renameTab('t1', 'main.ts');
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });
  });

  describe('restoreTabs', () => {
    it('backfills missing workflowMode using the language default', () => {
      const { restoreTabs } = useEditorStore.getState();
      restoreTabs([
        // No workflowMode — pre-Slice-2 persisted shape.
        { id: 't1', name: 'main.js', language: 'javascript', content: '' },
        { id: 't2', name: 'data.json', language: 'json', content: '' },
      ]);
      const tabs = useEditorStore.getState().tabs;
      expect(tabs.find((t) => t.id === 't1')?.workflowMode).toBe('scratchpad');
      expect(tabs.find((t) => t.id === 't2')?.workflowMode).toBe('run');
    });

    it('snaps an unsupported persisted mode back to the language default', () => {
      const { restoreTabs } = useEditorStore.getState();
      restoreTabs([
        {
          id: 't1',
          name: 'data.json',
          language: 'json',
          content: '',
          // JSON only supports `run`; a tampered `scratchpad` value
          // must snap back to `run`.
          workflowMode: 'scratchpad' as never,
        },
      ]);
      const tab = useEditorStore.getState().tabs[0];
      expect(tab?.workflowMode).toBe('run');
    });
  });
});
