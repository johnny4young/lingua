import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import { CommandPalette } from '../../src/renderer/components/CommandPalette/CommandPalette';

vi.mock('../../src/renderer/data/templates', () => ({
  BUILT_IN_TEMPLATES: [
    {
      id: 'js-hello',
      language: 'javascript',
      labelKey: 'templates.helloWorld.label',
      descriptionKey: 'templates.helloWorld.description',
      fileStemKey: 'templates.helloWorld.fileStem',
      content: 'console.log("hi")',
    },
  ],
  resolveTemplateFileStem: () => 'untitled',
  resolveTemplateLabel: () => 'Hello world',
  resolveTemplateDescription: () => 'Print a greeting',
}));

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: () => ({
    addTab: vi.fn(),
    openFileFromDisk: vi.fn().mockResolvedValue(undefined),
    saveActiveTabAs: vi.fn().mockResolvedValue(undefined),
    duplicateActiveTab: vi.fn(),
  }),
  createDefaultTab: (language: string) => ({
    id: `tab-${language}`,
    name: `untitled-${language}`,
    language,
    content: '',
    isDirty: false,
  }),
}));

vi.mock('../../src/renderer/stores/snippetsStore', () => ({
  useSnippetsStore: () => ({
    snippets: [],
  }),
}));

vi.mock('../../src/renderer/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    setLayoutPreset: vi.fn(),
  }),
}));

vi.mock('../../src/renderer/stores/updateStore', () => ({
  useUpdateStore: () => ({
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    restartToApply: vi.fn().mockResolvedValue(true),
    status: 'idle',
  }),
}));

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
  OverlayBackdrop: ({
    children,
    onClose,
  }: {
    children: React.ReactNode;
    onClose?: () => void;
  }) => (
    <div onClick={onClose}>
      {children}
    </div>
  ),
  OverlayCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../src/renderer/components/ui/keyboard', () => ({
  handleCloseOnEscape: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Search: () => null,
  X: () => null,
  Code: () => null,
  FileCode: () => null,
  Zap: () => null,
}));

describe('CommandPalette', () => {
  beforeEach(async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    await i18next.changeLanguage('en');
  });

  it('renders localized command palette UI in Spanish', async () => {
    await i18next.changeLanguage('es');

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    expect(
      screen.getByPlaceholderText('Buscar plantillas, fragmentos, comandos...')
    ).toBeTruthy();
    expect(screen.getByText('navegar')).toBeTruthy();
    expect(screen.getByText('seleccionar')).toBeTruthy();
    expect(screen.getByText(/\d+ resultados/)).toBeTruthy();
  });

  it('exposes the clear search action with an accessible label', async () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');

    fireEvent.change(input, { target: { value: 'set' } });

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy();
  });

  it('groups commands by category with eyebrow headers when the search is empty', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    // Both Actions (layout / settings / etc — built into the palette
    // unconditionally) and Templates (one mocked above) should appear
    // as eyebrow scopes. Snippets bucket is empty in this fixture, so
    // its header must NOT render.
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Templates')).toBeTruthy();
    expect(screen.queryByText('Snippets')).toBeNull();
  });

  it('flattens results without scope headers when the user types a query', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, { target: { value: 'layout' } });

    // Search results are intentionally flat; splitting a ranked list
    // across sections would push exact matches below near-misses from
    // a different category.
    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.queryByText('Templates')).toBeNull();
    expect(screen.queryByText('Snippets')).toBeNull();
  });

  it('renders a hint alongside the empty state when a query has zero matches', () => {
    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.change(input, {
      target: { value: 'zzzzzzzz-no-such-thing' },
    });

    // The new hint nudges the user toward Cmd+P or clearing the
    // query — partial match keeps the assertion resilient to copy
    // tweaks.
    expect(screen.queryByText(/Cmd\+P|clear the search/i)).toBeTruthy();
  });

  it('scrolls the highlighted command row instead of a grouped section header', async () => {
    const scrolledIndexes: string[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      value: vi.fn(function scrollIntoView(this: HTMLElement) {
        scrolledIndexes.push(this.dataset.resultIndex ?? 'missing');
      }),
      configurable: true,
      writable: true,
    });

    render(
      <CommandPalette
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenWhatsNew={vi.fn()}
        onStartGuidedTour={vi.fn()}
        onOpenSnippets={vi.fn()}
      />
    );

    const input = screen.getByPlaceholderText('Search templates, snippets, commands...');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    await waitFor(() => {
      expect(scrolledIndexes[scrolledIndexes.length - 1]).toBe('1');
    });
  });
});
