import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Monaco, OnMount } from '@monaco-editor/react';
import { useSmartPaste, requestPlainPaste } from '@/hooks/useSmartPaste';

/**
 * RL-110 — locks the paste hook's gating + toast wiring without a real Monaco
 * instance: detection runs for real (so hook<->detector integration is real),
 * everything else is mocked so we can assert the toast + telemetry + the
 * one-shot Cmd+Shift+V bypass.
 */
const mocks = vi.hoisted(() => ({
  enabled: true,
  pushStatusNotice: vi.fn(),
  dismissStatusNotice: vi.fn(),
  trackEvent: vi.fn().mockResolvedValue(undefined),
  applyPasteIntent: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ smartPasteDetectionEnabled: mocks.enabled }) },
}));
vi.mock('@/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      pushStatusNotice: mocks.pushStatusNotice,
      dismissStatusNotice: mocks.dismissStatusNotice,
    }),
  },
}));
vi.mock('@/utils/telemetry', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('@/clipboard/applyPasteIntent', () => ({ applyPasteIntent: mocks.applyPasteIntent }));

const CURL = "curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{\"a\":1}'";

function createHarness(pastedText: string) {
  let pasteCb: ((event: { range: unknown }) => void) | undefined;
  let commandCb: (() => void) | undefined;
  const trigger = vi.fn();
  const editor = {
    onDidPaste: (cb: (event: { range: unknown }) => void) => {
      pasteCb = cb;
      return { dispose: vi.fn() };
    },
    getModel: () => ({ getValueInRange: () => pastedText }),
    addCommand: (_binding: number, cb: () => void) => {
      commandCb = cb;
      return 'cmd-id';
    },
    trigger,
  } as unknown as Parameters<OnMount>[0];
  const monaco = {
    KeyMod: { CtrlCmd: 2048, Shift: 1024 },
    KeyCode: { KeyV: 52 },
  } as unknown as Monaco;
  return {
    editor,
    monaco,
    trigger,
    firePaste: () => pasteCb?.({ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 } }),
    fireCmdShiftV: () => commandCb?.(),
  };
}

beforeEach(() => {
  mocks.enabled = true;
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('useSmartPaste', () => {
  it('shows the import toast and fires shown telemetry on a detected paste', () => {
    const h = createHarness(CURL);
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      h.firePaste();
    });
    expect(mocks.pushStatusNotice).toHaveBeenCalledTimes(1);
    expect(mocks.trackEvent).toHaveBeenCalledWith('editor.smart_paste_shown', { handler: 'curl' });

    // The primary action imports + fires applied telemetry.
    const notice = mocks.pushStatusNotice.mock.calls[0]![0] as {
      actions: { onClick: () => void }[];
    };
    act(() => {
      notice.actions[0]!.onClick();
    });
    expect(mocks.trackEvent).toHaveBeenCalledWith('editor.smart_paste_applied', {
      handler: 'curl',
      accepted: true,
    });
    expect(mocks.applyPasteIntent).toHaveBeenCalledTimes(1);
  });

  it('keep-as-text fires applied with accepted=false', () => {
    const h = createHarness(CURL);
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      h.firePaste();
    });
    const notice = mocks.pushStatusNotice.mock.calls[0]![0] as {
      actions: { onClick: () => void }[];
    };
    act(() => {
      notice.actions[1]!.onClick();
    });
    expect(mocks.trackEvent).toHaveBeenCalledWith('editor.smart_paste_applied', {
      handler: 'curl',
      accepted: false,
    });
    expect(mocks.applyPasteIntent).not.toHaveBeenCalled();
  });

  it('IT2-F4 — suggests the matching utility with per-format telemetry + catalog label', () => {
    const h = createHarness('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsaW5ndWEifQ.c2lnbmF0dXJl');
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      h.firePaste();
    });
    expect(mocks.trackEvent).toHaveBeenCalledWith('editor.smart_paste_shown', {
      handler: 'utility-jwt',
    });
    const notice = mocks.pushStatusNotice.mock.calls[0]![0] as {
      messageKey: string;
      actions: { labelKey: string; onClick: () => void }[];
    };
    expect(notice.messageKey).toBe('paste.intent.utility.jwt.message');
    // The primary action reuses the catalog's own "Open JWT Debugger" label.
    expect(notice.actions[0]!.labelKey).toBe('utilities.tool.jwt.label');
    act(() => {
      notice.actions[0]!.onClick();
    });
    expect(mocks.trackEvent).toHaveBeenCalledWith('editor.smart_paste_applied', {
      handler: 'utility-jwt',
      accepted: true,
    });
    expect(mocks.applyPasteIntent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'utility', utilityId: 'jwt' }),
      expect.anything()
    );
  });

  it('does nothing when smart paste is disabled', () => {
    mocks.enabled = false;
    const h = createHarness(CURL);
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      h.firePaste();
    });
    expect(mocks.pushStatusNotice).not.toHaveBeenCalled();
  });

  it('does nothing for plain text that matches no handler', () => {
    const h = createHarness('const x = 1;');
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      h.firePaste();
    });
    expect(mocks.pushStatusNotice).not.toHaveBeenCalled();
  });

  it('requestPlainPaste (palette action / Cmd+Shift+V) bypasses the next paste', () => {
    const h = createHarness(CURL);
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      requestPlainPaste(h.editor); // shared by the palette action + the keybinding
    });
    expect(h.trigger).toHaveBeenCalledWith(
      'lingua-smart-paste',
      'editor.action.clipboardPasteAction',
      {}
    );
    act(() => {
      h.firePaste(); // the bypassed paste — no toast
    });
    expect(mocks.pushStatusNotice).not.toHaveBeenCalled();
  });

  it('Cmd+Shift+V skips detection for exactly the next paste', () => {
    const h = createHarness(CURL);
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      h.fireCmdShiftV(); // sets the one-shot skip flag + triggers a plain paste
    });
    expect(h.trigger).toHaveBeenCalledWith(
      'lingua-smart-paste',
      'editor.action.clipboardPasteAction',
      {}
    );
    act(() => {
      h.firePaste(); // this paste is the bypassed one — no toast
    });
    expect(mocks.pushStatusNotice).not.toHaveBeenCalled();
    act(() => {
      h.firePaste(); // the flag was one-shot — detection resumes
    });
    expect(mocks.pushStatusNotice).toHaveBeenCalledTimes(1);
  });

  it('clears the plain-paste bypass if Monaco never emits a paste event', () => {
    vi.useFakeTimers();
    const h = createHarness(CURL);
    renderHook(() => useSmartPaste(h.editor, h.monaco));
    act(() => {
      requestPlainPaste(h.editor);
      vi.advanceTimersByTime(1000);
    });

    act(() => {
      h.firePaste();
    });

    expect(mocks.pushStatusNotice).toHaveBeenCalledTimes(1);
  });
});
