import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsMerge } from '../../src/renderer/stores/settingsMerge';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';

function osPrefers(scheme: 'dark' | 'light') {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && scheme === 'dark',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

describe('settingsMerge · System theme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resyncs a stale editor theme to the OS before first render', () => {
    osPrefers('light');
    const merged = settingsMerge(
      { theme: 'system', editorTheme: 'lingua-dark' },
      useSettingsStore.getState()
    );
    expect(merged.theme).toBe('system');
    expect(merged.editorTheme).toBe('lingua-light');
  });

  it('leaves an explicit theme and its editor theme alone', () => {
    osPrefers('light');
    const merged = settingsMerge(
      { theme: 'dark', editorTheme: 'dracula' },
      useSettingsStore.getState()
    );
    expect(merged.editorTheme).toBe('dracula');
  });
});
