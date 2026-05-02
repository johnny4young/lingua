/**
 * RL-038 Slice C closeout — EditorEmptyState capability-aware quick-start
 * buttons. The empty-state hero now walks `LANGUAGE_PACKS` instead of a
 * hardcoded `['javascript', 'typescript', 'go', 'python', 'rust']`
 * array, and renders a localized "Desktop only" pill alongside the
 * language label for desktop-only packs (Go / Rust) on the web build.
 *
 * The web-build gate is platform-specific, not entitlement-driven; the
 * tests pin both the web and desktop branches plus the EN / ES (tuteo)
 * locale split.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';

const mockAddTab = vi.fn();

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: () => ({ addTab: mockAddTab }),
  createDefaultTab: (language: string) => ({
    id: `new-${language}`,
    name: `untitled.${language === 'typescript' ? 'ts' : 'js'}`,
    language,
    content: '',
    isDirty: false,
  }),
}));

vi.mock('@/utils/languageMeta', () => ({
  languageLabel: (id: string) =>
    id === 'javascript'
      ? 'JavaScript'
      : id === 'typescript'
        ? 'TypeScript'
        : id.charAt(0).toUpperCase() + id.slice(1),
  languageBadgeClass: () => 'badge',
  extensionForLanguage: (id: string) => (id === 'typescript' ? 'ts' : 'js'),
  languageCapabilityBadgeKey: (id: string) =>
    id === 'go' || id === 'rust' ? 'language.capability.desktopOnly' : null,
}));

vi.mock('@/data/templates', () => ({
  BUILT_IN_TEMPLATES: [
    {
      id: 'tpl-1',
      fileStem: 'Hello',
      labelKey: 'templates.tpl-1.label',
      descriptionKey: 'templates.tpl-1.description',
      language: 'javascript',
      code: '',
    },
  ],
  resolveTemplateFileStem: (tpl: { fileStem: string }) => tpl.fileStem,
  resolveTemplateLabel: () => 'Hello',
  resolveTemplateDescription: () => 'desc',
}));

vi.mock('@/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
}));

import { EditorEmptyState } from '@/components/Editor/EditorEmptyState';

interface LinguaWindow extends Window {
  lingua?: { platform: string };
}

function setPlatform(platform: 'web' | 'darwin' | 'win32' | 'linux'): void {
  (globalThis as unknown as LinguaWindow).lingua = { platform };
}

function clearPlatform(): void {
  delete (globalThis as unknown as LinguaWindow).lingua;
}

describe('EditorEmptyState — capability badges (RL-038)', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    mockAddTab.mockReset();
    clearPlatform();
  });

  afterEach(() => {
    clearPlatform();
  });

  it('renders quick-start buttons for runnable packs without the badge on a desktop build', () => {
    setPlatform('darwin');
    render(<EditorEmptyState />);

    expect(screen.getByTestId('empty-state-quick-start-javascript')).toBeTruthy();
    expect(screen.getByTestId('empty-state-quick-start-typescript')).toBeTruthy();
    expect(screen.getByTestId('empty-state-quick-start-go')).toBeTruthy();
    expect(screen.getByTestId('empty-state-quick-start-python')).toBeTruthy();
    expect(screen.getByTestId('empty-state-quick-start-rust')).toBeTruthy();

    // No "Desktop only" pill on darwin — Go / Rust really do run there.
    expect(screen.queryByTestId('empty-state-desktop-only-go')).toBeNull();
    expect(screen.queryByTestId('empty-state-desktop-only-rust')).toBeNull();
  });

  it('renders the "Desktop only" pill next to Go and Rust on the web build', () => {
    setPlatform('web');
    render(<EditorEmptyState />);

    expect(screen.getByTestId('empty-state-desktop-only-go').textContent).toBe('Desktop only');
    expect(screen.getByTestId('empty-state-desktop-only-rust').textContent).toBe('Desktop only');
    // Self-contained runtimes (JS / TS / Python) stay pill-free.
    expect(screen.queryByTestId('empty-state-desktop-only-javascript')).toBeNull();
    expect(screen.queryByTestId('empty-state-desktop-only-typescript')).toBeNull();
    expect(screen.queryByTestId('empty-state-desktop-only-python')).toBeNull();
  });

  it('localizes the "Desktop only" pill to tuteo Spanish', async () => {
    setPlatform('web');
    await i18next.changeLanguage('es');
    render(<EditorEmptyState />);

    expect(screen.getByTestId('empty-state-desktop-only-go').textContent).toBe(
      'Solo escritorio'
    );
    expect(screen.getByTestId('empty-state-desktop-only-rust').textContent).toBe(
      'Solo escritorio'
    );
  });

  it('keeps the desktop-only quick-start buttons clickable so the user can still create a tab', async () => {
    setPlatform('web');
    const user = userEvent.setup();
    render(<EditorEmptyState />);

    await user.click(screen.getByTestId('empty-state-quick-start-go'));
    expect(mockAddTab).toHaveBeenCalledWith(expect.objectContaining({ language: 'go' }));
  });
});
