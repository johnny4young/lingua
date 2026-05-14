/**
 * RL-020 Slice 6 — `setTabStdinBuffer` + language-change cleanup.
 *
 * Covers:
 *   - Setter writes the buffer for supported languages.
 *   - `null` and `''` clear the field (the panel passes `''` when
 *     the user empties the textarea).
 *   - Setter refuses unsupported languages (Rust / Go / JSON).
 *   - `renameTab` drops the buffer when the new language is outside
 *     {JS, TS, Python}.
 *   - `renameTab` inside the supported set preserves the buffer.
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

describe('editorStore — stdinBuffer per-tab (RL-020 Slice 6)', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    useEditorStore.setState({ tabs: [], activeTabId: null });
    setActiveProLicense();
  });

  it('writes the buffer for a JS tab', () => {
    const { addTab, setTabStdinBuffer } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    setTabStdinBuffer('t1', '2\n3');
    expect(useEditorStore.getState().tabs[0]?.stdinBuffer).toBe('2\n3');
  });

  it('clearing with null removes the field', () => {
    const { addTab, setTabStdinBuffer } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.ts', language: 'typescript', content: '' });
    setTabStdinBuffer('t1', '2\n3');
    setTabStdinBuffer('t1', null);
    expect(useEditorStore.getState().tabs[0]).not.toHaveProperty('stdinBuffer');
  });

  it('empty-string write also clears the field (panel sends "" when emptied)', () => {
    const { addTab, setTabStdinBuffer } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.py', language: 'python', content: '' });
    setTabStdinBuffer('t1', 'first');
    setTabStdinBuffer('t1', '');
    expect(useEditorStore.getState().tabs[0]).not.toHaveProperty('stdinBuffer');
  });

  it('refuses unsupported languages', () => {
    const { addTab, setTabStdinBuffer } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.rs', language: 'rust', content: '' });
    setTabStdinBuffer('t1', '2\n3');
    expect(useEditorStore.getState().tabs[0]?.stdinBuffer).toBeUndefined();
  });

  it('renameTab JS → Rust drops the buffer', () => {
    const { addTab, setTabStdinBuffer, renameTab } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    setTabStdinBuffer('t1', '2\n3');
    renameTab('t1', 'main.rs');
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.language).toBe('rust');
    expect(tab?.stdinBuffer).toBeUndefined();
  });

  it('renameTab JS → Python preserves the buffer', () => {
    const { addTab, setTabStdinBuffer, renameTab } = useEditorStore.getState();
    addTab({ id: 't1', name: 'main.js', language: 'javascript', content: '' });
    setTabStdinBuffer('t1', '2\n3');
    renameTab('t1', 'main.py');
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.language).toBe('python');
    expect(tab?.stdinBuffer).toBe('2\n3');
  });

  it('addTab/restoreTabs strips the buffer for unsupported languages', () => {
    const { restoreTabs } = useEditorStore.getState();
    restoreTabs([
      {
        id: 't1',
        name: 'main.rs',
        language: 'rust',
        content: '',
        // Tampered persisted entry pretending Rust supports stdin.
        stdinBuffer: '2\n3' as never,
      } as never,
    ]);
    const tab = useEditorStore.getState().tabs[0];
    expect(tab?.stdinBuffer).toBeUndefined();
  });
});
