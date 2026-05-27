import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';

function setActiveProLicense() {
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

describe('settingsStore', () => {
  const initialState = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();
  let originalLingua: typeof window.lingua;

  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState(initialState, true);
    useLicenseStore.setState(initialLicense, true);
    setActiveProLicense();
    originalLingua = window.lingua;
    if (!window.lingua) {
      window.lingua = {
        consent: {
          set: async () => ({ ok: true as const }),
        },
      } as typeof window.lingua;
    }
  });

  afterEach(() => {
    window.lingua = originalLingua;
    useLicenseStore.setState(initialLicense, true);
    vi.restoreAllMocks();
  });

  it('should have correct defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.editorTheme).toBe('lingua-dark');
    expect(state.fontSize).toBe(14);
    expect(state.wordWrap).toBe(false);
    expect(state.minimap).toBe(false);
    expect(state.layoutPreset).toBe('horizontal');
  });

  it('should set theme', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('should set editor theme', () => {
    useSettingsStore.getState().setEditorTheme('dracula');
    expect(useSettingsStore.getState().editorTheme).toBe('dracula');
  });

  it('should set font size', () => {
    useSettingsStore.getState().setFontSize(18);
    expect(useSettingsStore.getState().fontSize).toBe(18);
  });

  it('should set font family', () => {
    useSettingsStore.getState().setFontFamily('Menlo');
    expect(useSettingsStore.getState().fontFamily).toBe('Menlo');
  });

  it('keeps the default font family on the Free tier when an extended font is requested', () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    useSettingsStore.getState().setFontFamily('Menlo, monospace');
    expect(useSettingsStore.getState().fontFamily).toBe(
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace"
    );
  });

  it('should toggle word wrap', () => {
    expect(useSettingsStore.getState().wordWrap).toBe(false);
    useSettingsStore.getState().toggleWordWrap();
    expect(useSettingsStore.getState().wordWrap).toBe(true);
  });

  it('should toggle minimap', () => {
    expect(useSettingsStore.getState().minimap).toBe(false);
    useSettingsStore.getState().toggleMinimap();
    expect(useSettingsStore.getState().minimap).toBe(true);
  });

  it('seeds the Ruby runtime preference to auto + accepts the closed enum (RL-042 Slice 6)', () => {
    expect(useSettingsStore.getState().rubyRuntimePreference).toBe('auto');
    useSettingsStore.getState().setRubyRuntimePreference('system');
    expect(useSettingsStore.getState().rubyRuntimePreference).toBe('system');
    useSettingsStore.getState().setRubyRuntimePreference('wasm');
    expect(useSettingsStore.getState().rubyRuntimePreference).toBe('wasm');
    // Reject anything outside the closed enum — value stays at the last good.
    (useSettingsStore.getState().setRubyRuntimePreference as (
      v: string
    ) => void)('jruby');
    expect(useSettingsStore.getState().rubyRuntimePreference).toBe('wasm');
    useSettingsStore.getState().setRubyRuntimePreference('auto');
  });

  it('should set layout preset', () => {
    useSettingsStore.getState().setLayoutPreset('vertical');
    expect(useSettingsStore.getState().layoutPreset).toBe('vertical');

    useSettingsStore.getState().setLayoutPreset('editor-only');
    expect(useSettingsStore.getState().layoutPreset).toBe('editor-only');

    useSettingsStore.getState().setLayoutPreset('horizontal');
    expect(useSettingsStore.getState().layoutPreset).toBe('horizontal');
  });

  it('should default restoreSession to false', () => {
    expect(useSettingsStore.getState().restoreSession).toBe(false);
  });

  it('should toggle restoreSession', () => {
    useSettingsStore.getState().toggleRestoreSession();
    expect(useSettingsStore.getState().restoreSession).toBe(true);
    useSettingsStore.getState().toggleRestoreSession();
    expect(useSettingsStore.getState().restoreSession).toBe(false);
  });

  it('should default formatOnSave to false', () => {
    expect(useSettingsStore.getState().formatOnSave).toBe(false);
  });

  it('should toggle formatOnSave', () => {
    useSettingsStore.getState().toggleFormatOnSave();
    expect(useSettingsStore.getState().formatOnSave).toBe(true);
    useSettingsStore.getState().toggleFormatOnSave();
    expect(useSettingsStore.getState().formatOnSave).toBe(false);
  });

  it('fails closed when a persisted execution-history snapshot preference is malformed', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          executionHistorySnapshotEnabled: 'true',
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().executionHistorySnapshotEnabled).toBe(false);
  });

  it('should default vimMode to false and toggle cleanly (RL-037)', () => {
    expect(useSettingsStore.getState().vimMode).toBe(false);
    useSettingsStore.getState().toggleVimMode();
    expect(useSettingsStore.getState().vimMode).toBe(true);
    useSettingsStore.getState().toggleVimMode();
    expect(useSettingsStore.getState().vimMode).toBe(false);
  });

  it('applyThemePreset updates theming fields and leaves safety prefs alone', () => {
    useSettingsStore.setState({ formatOnSave: true, restoreSession: true });

    useSettingsStore.getState().applyThemePreset({
      theme: 'light',
      editorTheme: 'solarized-light',
      fontFamily: 'Menlo, monospace',
      fontSize: 18,
      layoutPreset: 'vertical',
    });

    const state = useSettingsStore.getState();
    expect(state.theme).toBe('light');
    expect(state.editorTheme).toBe('solarized-light');
    expect(state.fontFamily).toBe('Menlo, monospace');
    expect(state.fontSize).toBe(18);
    expect(state.layoutPreset).toBe('vertical');
    // Preset must not override workflow preferences
    expect(state.formatOnSave).toBe(true);
    expect(state.restoreSession).toBe(true);
  });

  it('blocks extended theme packs on the Free tier', () => {
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    expect(useSettingsStore.getState().themePack).toBe('default');
  });

  it('should default language to system', () => {
    expect(useSettingsStore.getState().language).toBe('system');
  });

  it('should default lastSeenVersion to null', () => {
    expect(useSettingsStore.getState().lastSeenVersion).toBeNull();
  });

  it('should default hasCompletedTour to false', () => {
    expect(useSettingsStore.getState().hasCompletedTour).toBe(false);
  });

  it('should default suppressTourAutoStart to false and persist toggles', () => {
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(false);
    useSettingsStore.getState().setSuppressTourAutoStart(true);
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(true);
    useSettingsStore.getState().setSuppressTourAutoStart(false);
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(false);
  });

  it('should set language to es', () => {
    useSettingsStore.getState().setLanguage('es');
    expect(useSettingsStore.getState().language).toBe('es');
  });

  it('should set language to en', () => {
    useSettingsStore.getState().setLanguage('en');
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('should set language back to system', () => {
    useSettingsStore.getState().setLanguage('en');
    useSettingsStore.getState().setLanguage('system');
    expect(useSettingsStore.getState().language).toBe('system');
  });

  it('tracks import-preview clipboard consent with the closed three-state enum', () => {
    expect(useSettingsStore.getState().importPreviewClipboardOnFocusConsent).toBe(
      'unset'
    );
    useSettingsStore.getState().setImportPreviewClipboardOnFocusConsent('granted');
    expect(useSettingsStore.getState().importPreviewClipboardOnFocusConsent).toBe(
      'granted'
    );
    useSettingsStore.getState().setImportPreviewClipboardOnFocusConsent('declined');
    expect(useSettingsStore.getState().importPreviewClipboardOnFocusConsent).toBe(
      'declined'
    );
  });

  it('sanitizes tampered import-preview clipboard consent on rehydrate', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: { importPreviewClipboardOnFocusConsent: 'always-read' },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().importPreviewClipboardOnFocusConsent).toBe(
      'unset'
    );
  });

  it('mirrors telemetry consent through the preload bridge when the toggle changes', async () => {
    const consentSet = vi.fn().mockResolvedValue({ ok: true });
    window.lingua = {
      ...window.lingua,
      consent: { set: consentSet },
    };

    useSettingsStore.getState().setTelemetryConsent('granted');
    await Promise.resolve();

    expect(consentSet).toHaveBeenCalledWith('granted');
  });

  it('should persist the last seen release version', () => {
    useSettingsStore.getState().setLastSeenVersion('0.1.0');
    expect(useSettingsStore.getState().lastSeenVersion).toBe('0.1.0');
  });

  it('should persist guided tour completion', () => {
    useSettingsStore.getState().setHasCompletedTour(true);
    expect(useSettingsStore.getState().hasCompletedTour).toBe(true);
  });

  it('seeds the consent mirror from persisted settings during rehydrate', async () => {
    const consentSet = vi.fn().mockResolvedValue({ ok: true });
    window.lingua = {
      ...window.lingua,
      consent: { set: consentSet },
    };

    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: { telemetryConsent: 'granted' },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    await Promise.resolve();
    expect(consentSet).toHaveBeenCalledWith('granted');
  });

  it('defaults shortcutOverrides to an empty map', () => {
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({});
  });

  it('defaults themePack to "default" and applies a pack wholesale', () => {
    expect(useSettingsStore.getState().themePack).toBe('default');
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    const state = useSettingsStore.getState();
    expect(state.themePack).toBe('solarized-daylight');
    expect(state.theme).toBe('light');
    expect(state.editorTheme).toBe('solarized-light');
  });

  it('applyThemePack with an unknown id is a no-op', () => {
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    useSettingsStore.getState().applyThemePack('does-not-exist');
    expect(useSettingsStore.getState().themePack).toBe('solarized-daylight');
  });

  it('keeps a persisted theme pack only when the stored appearance fields still match it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          themePack: 'solarized-daylight',
          theme: 'light',
          editorTheme: 'solarized-light',
          fontFamily: 'Menlo, monospace',
          fontSize: 14,
          layoutPreset: 'horizontal',
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().themePack).toBe('solarized-daylight');
  });

  it('drops a persisted theme pack back to default when the stored appearance no longer matches it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          themePack: 'solarized-daylight',
          theme: 'light',
          editorTheme: 'solarized-light',
          fontFamily: 'Menlo, monospace',
          fontSize: 20,
          layoutPreset: 'horizontal',
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.themePack).toBe('default');
    expect(state.fontSize).toBe(20);
  });

  it('manual appearance edit flips themePack back to default', () => {
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    useSettingsStore.getState().setFontSize(20);
    expect(useSettingsStore.getState().themePack).toBe('default');
    expect(useSettingsStore.getState().fontSize).toBe(20);
  });

  it('applyThemePack does not touch workflow prefs', () => {
    useSettingsStore.setState({
      formatOnSave: true,
      restoreSession: true,
    });
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    const state = useSettingsStore.getState();
    expect(state.formatOnSave).toBe(true);
    expect(state.restoreSession).toBe(true);
  });

  it('defaults keymapPreset to "default" and applies a preset by id', () => {
    expect(useSettingsStore.getState().keymapPreset).toBe('default');
    useSettingsStore.getState().applyKeymapPreset('sublime');
    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('sublime');
    expect(state.shortcutOverrides['nav-go-to-symbol']?.[0].tokens).toEqual(['Mod', 'R']);
  });

  it('applyKeymapPreset with an unknown id is a no-op', () => {
    useSettingsStore.getState().applyKeymapPreset('sublime');
    useSettingsStore.getState().applyKeymapPreset('does-not-exist');
    expect(useSettingsStore.getState().keymapPreset).toBe('sublime');
  });

  it('keeps a persisted keymap preset only when the stored overrides still match it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          keymapPreset: 'sublime',
          shortcutOverrides: {
            'nav-go-to-symbol': [{ tokens: ['Mod', 'R'] }],
            'view-toggle-console': [{ tokens: ['Mod', 'Backtick'] }],
          },
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().keymapPreset).toBe('sublime');
  });

  it('drops a persisted keymap preset back to default when stored overrides no longer match it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          keymapPreset: 'sublime',
          shortcutOverrides: {
            'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'B'] }],
          },
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('default');
    expect(state.shortcutOverrides['view-toggle-sidebar']?.[0].tokens).toEqual([
      'Mod',
      'Shift',
      'B',
    ]);
  });

  it('manual override flips keymapPreset back to default', () => {
    useSettingsStore.getState().applyKeymapPreset('sublime');
    useSettingsStore.getState().setShortcutOverride('view-toggle-sidebar', [
      { tokens: ['Mod', 'Shift', 'B'] },
    ]);
    expect(useSettingsStore.getState().keymapPreset).toBe('default');
  });

  it('resetShortcutOverrides clears preset back to default', () => {
    useSettingsStore.getState().applyKeymapPreset('sublime');
    useSettingsStore.getState().resetShortcutOverrides();
    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('default');
    expect(state.shortcutOverrides).toEqual({});
  });

  it('setShortcutOverride stores combos keyed by shortcut id', () => {
    useSettingsStore.getState().setShortcutOverride('view-toggle-sidebar', [
      { tokens: ['Mod', 'Shift', 'B'] },
    ]);
    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(overrides['view-toggle-sidebar']?.[0].tokens).toEqual(['Mod', 'Shift', 'B']);
  });

  it('clearShortcutOverride removes a single entry without touching the rest', () => {
    useSettingsStore.getState().setShortcutOverride('view-toggle-sidebar', [
      { tokens: ['Mod', 'Shift', 'B'] },
    ]);
    useSettingsStore.getState().setShortcutOverride('file-save', [
      { tokens: ['Mod', 'Alt', 'S'] },
    ]);
    useSettingsStore.getState().clearShortcutOverride('file-save');
    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(overrides['file-save']).toBeUndefined();
    expect(overrides['view-toggle-sidebar']).toBeDefined();
  });

  it('resetShortcutOverrides empties the map', () => {
    useSettingsStore.getState().setShortcutOverride('file-save', [
      { tokens: ['Mod', 'Alt', 'S'] },
    ]);
    useSettingsStore.getState().resetShortcutOverrides();
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({});
  });

  it('drops malformed shortcut overrides during rehydration', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          shortcutOverrides: {
            'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'B'] }],
            'unknown-id': [{ tokens: ['Mod', 'Q'] }],
            'file-save': 'not-an-array',
            'nav-quick-open': [{ tokens: [] }],
            'nav-go-to-symbol': [{ tokens: ['Mod', 'Shift', 'R'] }],
            'view-toggle-console': [{ tokens: ['J'] }],
          },
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(Object.keys(overrides)).toEqual(['view-toggle-sidebar']);
    expect(overrides['view-toggle-sidebar']?.[0].tokens).toEqual(['Mod', 'Shift', 'B']);
  });

  it('should ignore an invalid persisted language during rehydration', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          language: 'fr',
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().language).toBe('system');
  });

  describe('RL-079 — nativeExecutionAcknowledged', () => {
    it('defaults to false on a fresh store', () => {
      expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(false);
    });

    it('flips via setNativeExecutionAcknowledged', () => {
      useSettingsStore.getState().setNativeExecutionAcknowledged(true);
      expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(true);
      useSettingsStore.getState().setNativeExecutionAcknowledged(false);
      expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(false);
    });

    it('rehydrates from localStorage when previously acknowledged', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            nativeExecutionAcknowledged: true,
          },
          version: 0,
        })
      );

      await (
        useSettingsStore as typeof useSettingsStore & {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist.rehydrate();

      expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(true);
    });

    it('fails closed when the persisted acknowledgement is malformed', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            nativeExecutionAcknowledged: 'true',
          },
          version: 0,
        })
      );

      await (
        useSettingsStore as typeof useSettingsStore & {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist.rehydrate();

      expect(useSettingsStore.getState().nativeExecutionAcknowledged).toBe(false);
    });
  });

  describe('RL-020 Slice 2 — workflow mode defaults', () => {
    it('seeds the three Scratchpad languages on a fresh store (fold C)', () => {
      const defaults = useSettingsStore.getState().workflowModeDefaultsByLanguage;
      expect(defaults).toEqual({
        javascript: 'scratchpad',
        typescript: 'scratchpad',
        python: 'scratchpad',
      });
    });

    it('setWorkflowModeDefault stores a supported override', () => {
      useSettingsStore.getState().setWorkflowModeDefault('javascript', 'run');
      expect(
        useSettingsStore.getState().workflowModeDefaultsByLanguage.javascript
      ).toBe('run');
    });

    it('setWorkflowModeDefault refuses an unsupported mode', () => {
      useSettingsStore
        .getState()
        .setWorkflowModeDefault('python', 'debug' as never);
      // Python does not support debug — the seed `scratchpad` stands.
      expect(
        useSettingsStore.getState().workflowModeDefaultsByLanguage.python
      ).toBe('scratchpad');
    });

    it('setWorkflowModeDefault refuses languages outside the Settings surface', () => {
      useSettingsStore.getState().setWorkflowModeDefault('rust', 'run');
      expect(useSettingsStore.getState().workflowModeDefaultsByLanguage).toEqual({
        javascript: 'scratchpad',
        typescript: 'scratchpad',
        python: 'scratchpad',
      });
    });

    it('setWorkflowModeDefault(null) clears the override', () => {
      useSettingsStore.getState().setWorkflowModeDefault('javascript', 'run');
      useSettingsStore.getState().setWorkflowModeDefault('javascript', null);
      expect(
        useSettingsStore.getState().workflowModeDefaultsByLanguage.javascript
      ).toBeUndefined();
    });

    it('rehydrates persisted overrides + reseeds blank slots (fold C)', async () => {
      // Persist a single explicit override (Python → Run) and assert
      // that the seed fills the remaining JS / TS slots without
      // overwriting the user choice.
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            workflowModeDefaultsByLanguage: { python: 'run' },
          },
          version: 0,
        })
      );

      await (
        useSettingsStore as typeof useSettingsStore & {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist.rehydrate();

      expect(
        useSettingsStore.getState().workflowModeDefaultsByLanguage
      ).toEqual({
        javascript: 'scratchpad',
        typescript: 'scratchpad',
        python: 'run',
      });
    });

    it('sanitizes tampered persisted values on rehydrate', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            workflowModeDefaultsByLanguage: {
              rust: 'run',
              ruby: 'run',
              python: 'debug',
              javascript: 'banana',
            },
          },
          version: 0,
        })
      );

      await (
        useSettingsStore as typeof useSettingsStore & {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist.rehydrate();

      // `rust:run` and `ruby:run` are outside the Settings surface — drop.
      // `python:debug` invalid (Python doesn't support debug) — drop.
      // `javascript:banana` invalid (not a WorkflowMode) — drop.
      // After sanitize the map is empty; the seed re-fills the
      // three Scratchpad languages with their canonical defaults.
      expect(
        useSettingsStore.getState().workflowModeDefaultsByLanguage
      ).toEqual({
        javascript: 'scratchpad',
        typescript: 'scratchpad',
        python: 'scratchpad',
      });
    });

    it('firstWorkflowModeSwitchAcknowledged defaults to false and flips via the setter (fold F)', () => {
      expect(
        useSettingsStore.getState().firstWorkflowModeSwitchAcknowledged
      ).toBe(false);
      useSettingsStore.getState().acknowledgeFirstWorkflowModeSwitch();
      expect(
        useSettingsStore.getState().firstWorkflowModeSwitchAcknowledged
      ).toBe(true);
    });
  });

  describe('RL-020 Slice 5 — scratchpad auto-log defaults', () => {
    it('seeds JS + TS to OFF on a fresh store', () => {
      expect(
        useSettingsStore.getState().scratchpadAutoLogByLanguage
      ).toEqual({ javascript: false, typescript: false });
    });

    it('setScratchpadAutoLogDefault stores a supported override', () => {
      useSettingsStore.getState().setScratchpadAutoLogDefault('javascript', true);
      expect(
        useSettingsStore.getState().scratchpadAutoLogByLanguage.javascript
      ).toBe(true);
    });

    it('setScratchpadAutoLogDefault refuses unsupported languages', () => {
      useSettingsStore.getState().setScratchpadAutoLogDefault('python', true);
      expect(
        useSettingsStore.getState().scratchpadAutoLogByLanguage
      ).toEqual({ javascript: false, typescript: false });
    });

    it('rehydrates a persisted override + reseeds blank slots', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            scratchpadAutoLogByLanguage: { javascript: true },
          },
          version: 0,
        })
      );
      await (
        useSettingsStore as typeof useSettingsStore & {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist.rehydrate();
      expect(
        useSettingsStore.getState().scratchpadAutoLogByLanguage
      ).toEqual({ javascript: true, typescript: false });
    });

    it('sanitizes tampered persisted values on rehydrate', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            scratchpadAutoLogByLanguage: {
              rust: true,
              python: true,
              javascript: 'yes',
              typescript: 1,
            },
          },
          version: 0,
        })
      );
      await (
        useSettingsStore as typeof useSettingsStore & {
          persist: { rehydrate: () => Promise<void> };
        }
      ).persist.rehydrate();
      // Unknown languages are dropped; non-boolean values coerce to
      // `false`; missing keys re-seed to `false`.
      expect(
        useSettingsStore.getState().scratchpadAutoLogByLanguage
      ).toEqual({ javascript: false, typescript: false });
    });
  });

  describe('RL-020 Slice 6 — showStdinPanel master toggle (fold D)', () => {
    it('defaults to true on a fresh store', () => {
      expect(useSettingsStore.getState().showStdinPanel).toBe(true);
    });
    it('flips via the toggle', () => {
      useSettingsStore.getState().toggleShowStdinPanel();
      expect(useSettingsStore.getState().showStdinPanel).toBe(false);
      useSettingsStore.getState().toggleShowStdinPanel();
      expect(useSettingsStore.getState().showStdinPanel).toBe(true);
    });

    it('sanitizes tampered persisted values on rehydrate', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            showStdinPanel: 'yes',
          },
          version: 0,
        })
      );

      await useSettingsStore.persist.rehydrate();
      expect(useSettingsStore.getState().showStdinPanel).toBe(true);
    });
  });

  describe('RL-020 Slice 7 — runtimeTimeoutPresetByLanguage', () => {
    it('seeds defaults (Python=long, others=normal)', () => {
      expect(
        useSettingsStore.getState().runtimeTimeoutPresetByLanguage
      ).toEqual({
        javascript: 'normal',
        typescript: 'normal',
        python: 'long',
        go: 'normal',
        ruby: 'normal',
      });
    });

    it('setRuntimeTimeoutPreset writes a supported value', () => {
      useSettingsStore
        .getState()
        .setRuntimeTimeoutPreset('javascript', 'quick');
      expect(
        useSettingsStore.getState().runtimeTimeoutPresetByLanguage.javascript
      ).toBe('quick');
    });

    it('setRuntimeTimeoutPreset refuses unsupported languages', () => {
      useSettingsStore.getState().setRuntimeTimeoutPreset('rust', 'quick');
      expect(
        useSettingsStore.getState().runtimeTimeoutPresetByLanguage.rust
      ).toBeUndefined();
    });

    it('setRuntimeTimeoutPreset refuses unknown preset tokens', () => {
      const before =
        useSettingsStore.getState().runtimeTimeoutPresetByLanguage.python;
      useSettingsStore
        .getState()
        // @ts-expect-error - exercising the runtime guard
        .setRuntimeTimeoutPreset('python', 'forever');
      expect(
        useSettingsStore.getState().runtimeTimeoutPresetByLanguage.python
      ).toBe(before);
    });

    it('drops tampered persisted entries on rehydrate', async () => {
      localStorage.setItem(
        'lingua-settings',
        JSON.stringify({
          state: {
            runtimeTimeoutPresetByLanguage: {
              javascript: 'extended',
              rust: 'quick',
              python: 'pizza',
            },
          },
          version: 0,
        })
      );

      await useSettingsStore.persist.rehydrate();
      const stored =
        useSettingsStore.getState().runtimeTimeoutPresetByLanguage;
      expect(stored.javascript).toBe('extended');
      expect(stored.rust).toBeUndefined();
      // Tampered tokens drop and re-seed to the language default.
      expect(stored.python).toBe('long');
      expect(stored.typescript).toBe('normal');
      expect(stored.go).toBe('normal');
    });

    it('toggleShowTimeoutCountdown flips the fold-E flag', () => {
      expect(useSettingsStore.getState().showTimeoutCountdown).toBe(false);
      useSettingsStore.getState().toggleShowTimeoutCountdown();
      expect(useSettingsStore.getState().showTimeoutCountdown).toBe(true);
      useSettingsStore.getState().toggleShowTimeoutCountdown();
      expect(useSettingsStore.getState().showTimeoutCountdown).toBe(false);
    });
  });
});
