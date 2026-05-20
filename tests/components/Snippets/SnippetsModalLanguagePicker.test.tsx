/**
 * RL-038 Slice C closeout — SnippetsModal language picker.
 *
 * The picker now walks `LANGUAGE_PACKS` (runnable + compile execution
 * modes) instead of a hardcoded `['javascript', 'typescript', 'go',
 * 'python', 'rust']` list, so Lua now appears through the registry too.
 * On the web build the picker appends a localized
 * "(desktop only)" suffix to options whose pack carries
 * `runtimeDependencies` (Go / Rust). These tests pin the new behavior
 * across web vs desktop and EN vs ES (tuteo).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { SnippetsModal } from '@/components/Snippets';
import { useEditorStore } from '@/stores/editorStore';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSnippetsStore } from '@/stores/snippetsStore';

interface LinguaWindow extends Window {
  lingua?: { platform: string };
}

function setPlatform(platform: 'web' | 'darwin' | 'win32' | 'linux'): void {
  (globalThis as unknown as LinguaWindow).lingua = { platform };
}

function clearPlatform(): void {
  delete (globalThis as unknown as LinguaWindow).lingua;
}

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

function getOptionTexts(): string[] {
  const select = screen.getByTestId('snippets-language-select') as HTMLSelectElement;
  return Array.from(select.querySelectorAll('option')).map((option) => option.textContent ?? '');
}

describe('SnippetsModal — language picker (RL-038)', () => {
  beforeEach(async () => {
    initI18n('en');
    await act(async () => {
      await i18next.changeLanguage('en');
    });
    setActiveProLicense();
    useSnippetsStore.setState({ snippets: [], pendingLinkedSnippetId: null });
    useEditorStore.setState({
      ...useEditorStore.getState(),
      tabs: [],
      activeTabId: null,
    });
    clearPlatform();
  });

  afterEach(() => {
    clearPlatform();
  });

  it('lists registry runnable packs without a desktop-only suffix on a desktop build', () => {
    setPlatform('darwin');
    render(<SnippetsModal onClose={vi.fn()} />);

    const options = getOptionTexts();

    // The five legacy built-ins plus Lua, which is runnable through the
    // plugin registry and should not be lost when consumers walk
    // LANGUAGE_PACKS instead of hardcoded arrays.
    expect(options).toContain('JavaScript');
    expect(options).toContain('TypeScript');
    expect(options).toContain('Go');
    expect(options).toContain('Python');
    expect(options).toContain('Rust');
    expect(options).toContain('Lua');
    expect(options).toContain('Ruby');
    // No (desktop only) suffix should leak on desktop.
    expect(options.some((option) => /desktop only/i.test(option))).toBe(false);
  });

  it('appends "(desktop only)" to Go and Rust on the web build', () => {
    setPlatform('web');
    render(<SnippetsModal onClose={vi.fn()} />);

    const options = getOptionTexts();

    expect(options).toContain('Go (desktop only)');
    expect(options).toContain('Rust (desktop only)');
    // Self-contained runtimes stay unsuffixed.
    expect(options).toContain('JavaScript');
    expect(options).toContain('TypeScript');
    expect(options).toContain('Python');
    expect(options).toContain('Lua');
    expect(options).toContain('Ruby');
    expect(options.find((option) => option.startsWith('JavaScript'))).toBe('JavaScript');
    expect(options.find((option) => option.startsWith('Python'))).toBe('Python');
    expect(options.find((option) => option.startsWith('Lua'))).toBe('Lua');
    expect(options.find((option) => option.startsWith('Ruby'))).toBe('Ruby');
  });

  it('localizes the desktop-only suffix in tuteo Spanish', async () => {
    setPlatform('web');
    await act(async () => {
      await i18next.changeLanguage('es');
    });
    render(<SnippetsModal onClose={vi.fn()} />);

    const options = getOptionTexts();
    expect(options).toContain('Go (solo escritorio)');
    expect(options).toContain('Rust (solo escritorio)');
  });

  it('keeps desktop-only options selectable so a snippet can still be saved on web', () => {
    setPlatform('web');
    render(<SnippetsModal onClose={vi.fn()} />);

    const select = screen.getByTestId('snippets-language-select') as HTMLSelectElement;
    const goOption = Array.from(select.querySelectorAll('option')).find(
      (option) => option.value === 'go'
    );
    expect(goOption).toBeDefined();
    // Suffix is informational; the option must remain interactive — saving
    // a Go snippet on web is a legitimate user action.
    expect((goOption as HTMLOptionElement).disabled).toBe(false);
  });
});
