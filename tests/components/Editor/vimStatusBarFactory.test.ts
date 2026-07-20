/**
 * internal Vim mode integration — `createLocalizedStatusBarClass` translates
 * upstream `monaco-vim` mode change events into i18n-backed status bar
 * text. The subclass keeps every other surface (`setSec` for ex commands,
 * `setKeyBuffer` for partial chords) flowing through the upstream class
 * untouched.
 *
 * These tests pin the mode-string mapping for every `VimModeChangeEvent`
 * the upstream library emits today plus the `normal` fallback.
 */

import { describe, expect, it, vi } from 'vitest';
import { createLocalizedStatusBarClass } from '@/components/Editor/vimStatusBarFactory';

class FakeBaseStatusBar {
  public lastText: string | null = null;
  // The upstream class takes (node, editor, sanitizer); we don't care
  // for these tests — record nothing.
  constructor(_node?: HTMLElement, _editor?: unknown, _sanitizer?: unknown) {
    void _node;
    void _editor;
    void _sanitizer;
  }
  setText(text: string): void {
    this.lastText = text;
  }
}

function fakeT(): (key: string) => string {
  // Map keys to the literal English strings the Settings UI ships in
  // `en/common.json` so the test reads with copy-grep ergonomics.
  const dict: Record<string, string> = {
    'editor.vimMode.statusBar.normal': '-- NORMAL --',
    'editor.vimMode.statusBar.insert': '-- INSERT --',
    'editor.vimMode.statusBar.visual': '-- VISUAL --',
    'editor.vimMode.statusBar.visualLine': '-- VISUAL LINE --',
    'editor.vimMode.statusBar.visualBlock': '-- VISUAL BLOCK --',
    'editor.vimMode.statusBar.replace': '-- REPLACE --',
  };
  return (key: string) => dict[key] ?? `[missing:${key}]`;
}

describe('createLocalizedStatusBarClass', () => {
  it('routes setMode("normal") through the localized normal string', () => {
    const Localized = createLocalizedStatusBarClass(
      FakeBaseStatusBar as unknown as Parameters<typeof createLocalizedStatusBarClass>[0],
      fakeT()
    );
    const instance = new Localized() as unknown as FakeBaseStatusBar;
    (instance as unknown as { setMode(ev: { mode: string }): void }).setMode({ mode: 'normal' });
    expect(instance.lastText).toBe('-- NORMAL --');
  });

  it('routes setMode("insert") through the localized insert string', () => {
    const Localized = createLocalizedStatusBarClass(
      FakeBaseStatusBar as unknown as Parameters<typeof createLocalizedStatusBarClass>[0],
      fakeT()
    );
    const instance = new Localized() as unknown as FakeBaseStatusBar;
    (instance as unknown as { setMode(ev: { mode: string }): void }).setMode({ mode: 'insert' });
    expect(instance.lastText).toBe('-- INSERT --');
  });

  it('routes setMode("replace") through the localized replace string', () => {
    const Localized = createLocalizedStatusBarClass(
      FakeBaseStatusBar as unknown as Parameters<typeof createLocalizedStatusBarClass>[0],
      fakeT()
    );
    const instance = new Localized() as unknown as FakeBaseStatusBar;
    (instance as unknown as { setMode(ev: { mode: string }): void }).setMode({ mode: 'replace' });
    expect(instance.lastText).toBe('-- REPLACE --');
  });

  it('disambiguates the three visual sub-modes', () => {
    const Localized = createLocalizedStatusBarClass(
      FakeBaseStatusBar as unknown as Parameters<typeof createLocalizedStatusBarClass>[0],
      fakeT()
    );
    const instance = new Localized() as unknown as FakeBaseStatusBar;
    type SetMode = (ev: { mode: string; subMode?: string }) => void;

    (instance as unknown as { setMode: SetMode }).setMode({ mode: 'visual' });
    expect(instance.lastText).toBe('-- VISUAL --');

    (instance as unknown as { setMode: SetMode }).setMode({
      mode: 'visual',
      subMode: 'linewise',
    });
    expect(instance.lastText).toBe('-- VISUAL LINE --');

    (instance as unknown as { setMode: SetMode }).setMode({
      mode: 'visual',
      subMode: 'blockwise',
    });
    expect(instance.lastText).toBe('-- VISUAL BLOCK --');
  });

  it('falls back to the localized normal string for unknown modes', () => {
    const Localized = createLocalizedStatusBarClass(
      FakeBaseStatusBar as unknown as Parameters<typeof createLocalizedStatusBarClass>[0],
      fakeT()
    );
    const instance = new Localized() as unknown as FakeBaseStatusBar;
    (instance as unknown as { setMode(ev: { mode: string }): void }).setMode({
      mode: 'something-future-monaco-vim-adds',
    });
    expect(instance.lastText).toBe('-- NORMAL --');
  });

  it('honors the live translator so locale switches reflect immediately', () => {
    const tSpy = vi.fn((key: string) =>
      key === 'editor.vimMode.statusBar.insert' ? '-- INSERTAR --' : '[?]'
    );
    const Localized = createLocalizedStatusBarClass(
      FakeBaseStatusBar as unknown as Parameters<typeof createLocalizedStatusBarClass>[0],
      tSpy
    );
    const instance = new Localized() as unknown as FakeBaseStatusBar;
    (instance as unknown as { setMode(ev: { mode: string }): void }).setMode({ mode: 'insert' });

    expect(instance.lastText).toBe('-- INSERTAR --');
    expect(tSpy).toHaveBeenCalledWith('editor.vimMode.statusBar.insert');
  });
});
