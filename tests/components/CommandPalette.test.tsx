import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { CommandPalette } from '../../src/renderer/components/CommandPalette/CommandPalette';

vi.mock('../../src/renderer/data/templates', () => ({
  BUILT_IN_TEMPLATES: [],
  resolveTemplateFileStem: () => '',
  resolveTemplateLabel: () => '',
  resolveTemplateDescription: () => '',
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
    expect(screen.getByText('13 resultados')).toBeTruthy();
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
});
