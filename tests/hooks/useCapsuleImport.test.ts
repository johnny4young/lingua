/**
 * RL-094 Slice 2 — tests for the `useCapsuleImport` orchestration hook.
 *
 * Renders the hook through `@testing-library/react`'s `renderHook` so
 * the React state updates land correctly. Telemetry is asserted via a
 * spy on the real `trackEvent` module export — the parity test in
 * update-server pins the closed enums on the wire, so this layer just
 * needs to verify the call site fires the right shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCapsuleImport } from '@/hooks/useCapsuleImport';
import { useEditorStore } from '@/stores/editorStore';
import { useSettingsStore } from '@/stores/settingsStore';
import * as telemetry from '@/utils/telemetry';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';

function makeFile(content: string, name = 'capsule.json'): File {
  return new File([content], name, { type: 'application/json' });
}

describe('useCapsuleImport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useSettingsStore.setState({
      capsuleImportClipboardOnFocusConsent: 'unset',
    });
  });

  it('decodes valid paste JSON and stores the decoded capsule', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockResolvedValue();
    const { result } = renderHook(() => useCapsuleImport());

    act(() => {
      result.current.decodeFromText(JSON.stringify(FIXTURE_MINIMAL_JS));
    });

    expect(result.current.state.kind).toBe('decoded');
    if (result.current.state.kind !== 'decoded') return;
    expect(result.current.state.capsule.tab.language).toBe('javascript');
    expect(result.current.state.sourceSurface).toBe('paste');
    // Fold D telemetry — decoded path.
    expect(trackSpy).toHaveBeenCalledWith(
      'capsule.imported',
      expect.objectContaining({
        surface: 'paste',
        status: 'decoded',
      })
    );
  });

  it('reports rejected state with the closed-enum reason', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockResolvedValue();
    const { result } = renderHook(() => useCapsuleImport());

    act(() => {
      result.current.decodeFromText('{not-json');
    });

    expect(result.current.state.kind).toBe('rejected');
    if (result.current.state.kind !== 'rejected') return;
    expect(result.current.state.reason).toBe('malformed-json');
    expect(trackSpy).toHaveBeenCalledWith(
      'capsule.imported',
      expect.objectContaining({
        surface: 'paste',
        status: 'rejected',
      })
    );
  });

  it('decodes file picker uploads', async () => {
    const { result } = renderHook(() => useCapsuleImport());
    await act(async () => {
      await result.current.decodeFromFile(
        makeFile(JSON.stringify(FIXTURE_MINIMAL_JS)),
        'file-picker'
      );
    });
    expect(result.current.state.kind).toBe('decoded');
    if (result.current.state.kind !== 'decoded') return;
    expect(result.current.state.sourceSurface).toBe('file-picker');
  });

  it('rejects oversized files before reading text', async () => {
    const { result } = renderHook(() => useCapsuleImport());
    const huge = new File([new Uint8Array(10 * 1024 * 1024)], 'huge.json', {
      type: 'application/json',
    });
    await act(async () => {
      await result.current.decodeFromFile(huge, 'drag-drop');
    });
    expect(result.current.state.kind).toBe('rejected');
    if (result.current.state.kind !== 'rejected') return;
    expect(result.current.state.reason).toBe('oversized');
    expect(result.current.state.sourceSurface).toBe('drag-drop');
  });

  it('openInNewTab pushes a tab with capsule source content', () => {
    const { result } = renderHook(() => useCapsuleImport());
    act(() => {
      result.current.decodeFromText(JSON.stringify(FIXTURE_MINIMAL_JS));
    });
    act(() => {
      result.current.openInNewTab();
    });
    const tabs = useEditorStore.getState().tabs;
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.content).toBe(FIXTURE_MINIMAL_JS.source.content);
    expect(tabs[0]?.language).toBe('javascript');
  });

  it('fires open-confirmed telemetry on openInNewTab', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockResolvedValue();
    const { result } = renderHook(() => useCapsuleImport());
    act(() => {
      result.current.decodeFromText(JSON.stringify(FIXTURE_MINIMAL_JS));
    });
    trackSpy.mockClear();
    act(() => {
      result.current.openInNewTab();
    });
    expect(trackSpy).toHaveBeenCalledWith(
      'capsule.imported',
      expect.objectContaining({
        surface: 'paste',
        status: 'open-confirmed',
      })
    );
  });

  it('reset clears decoded state + fires cancelled telemetry', () => {
    const trackSpy = vi.spyOn(telemetry, 'trackEvent').mockResolvedValue();
    const { result } = renderHook(() => useCapsuleImport());
    act(() => {
      result.current.decodeFromText(JSON.stringify(FIXTURE_MINIMAL_JS));
    });
    trackSpy.mockClear();
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.kind).toBe('empty');
    expect(trackSpy).toHaveBeenCalledWith(
      'capsule.imported',
      expect.objectContaining({
        status: 'cancelled',
      })
    );
  });

  it('attemptClipboardAutofill returns null without consent', async () => {
    const { result } = renderHook(() => useCapsuleImport());
    const out = await result.current.attemptClipboardAutofill();
    expect(out).toBeNull();
  });

  it('attemptClipboardAutofill decodes when consent + valid clipboard', async () => {
    useSettingsStore.setState({
      capsuleImportClipboardOnFocusConsent: 'granted',
    });
    const reader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue(JSON.stringify(FIXTURE_MINIMAL_JS));
    const { result } = renderHook(() =>
      useCapsuleImport({ readClipboard: reader })
    );
    let out: unknown;
    await act(async () => {
      out = await result.current.attemptClipboardAutofill();
    });
    expect(out).toMatchObject({ ok: true });
    expect(reader).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.state.kind).toBe('decoded'));
  });

  it('attemptClipboardAutofill returns null for non-JSON clipboard', async () => {
    useSettingsStore.setState({
      capsuleImportClipboardOnFocusConsent: 'granted',
    });
    const reader = vi
      .fn<() => Promise<string>>()
      .mockResolvedValue('just some text');
    const { result } = renderHook(() =>
      useCapsuleImport({ readClipboard: reader })
    );
    const out = await result.current.attemptClipboardAutofill();
    expect(out).toBeNull();
  });

  it('openInNewTab is idempotent — second click after confirm is a no-op', () => {
    // Reviewer fix (RL-094 Slice 2 final pass) — fast double-click on
    // the confirm button would otherwise create two identical tabs
    // before the overlay-close commit unmounts the button. The hook
    // clears `decodedRef` on the first call so the second is no-op.
    const { result } = renderHook(() => useCapsuleImport());
    act(() => {
      result.current.decodeFromText(JSON.stringify(FIXTURE_MINIMAL_JS));
    });
    act(() => {
      result.current.openInNewTab();
      result.current.openInNewTab();
    });
    expect(useEditorStore.getState().tabs.length).toBe(1);
  });

  it('handles file.text() failure as malformed-json rejection', async () => {
    const { result } = renderHook(() => useCapsuleImport());
    const failing = {
      size: 100,
      text: () => Promise.reject(new Error('reader dead')),
      name: 'capsule.json',
      type: 'application/json',
    } as unknown as File;
    await act(async () => {
      await result.current.decodeFromFile(failing, 'drag-drop');
    });
    expect(result.current.state.kind).toBe('rejected');
    if (result.current.state.kind !== 'rejected') return;
    expect(result.current.state.reason).toBe('malformed-json');
    expect(result.current.state.detail).toBe('file-read-failed');
  });
});
