import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';

const mockAddTab = vi.fn();

vi.mock('../../src/renderer/stores/editorStore', () => ({
  useEditorStore: () => ({ addTab: mockAddTab }),
  createDefaultTab: (language: string) => ({
    id: `new-${language}`,
    name: `untitled.${language === 'typescript' ? 'ts' : 'js'}`,
    language,
    content: '',
    isDirty: false,
  }),
}));

vi.mock('../../src/renderer/utils/languageMeta', () => ({
  languageLabel: (id: string) =>
    id === 'javascript'
      ? 'JavaScript'
      : id === 'typescript'
        ? 'TypeScript'
        : id.charAt(0).toUpperCase() + id.slice(1),
  languageBadgeClass: () => 'badge',
  extensionForLanguage: (id: string) => (id === 'typescript' ? 'ts' : 'js'),
}));

vi.mock('../../src/renderer/data/templates', () => ({
  BUILT_IN_TEMPLATES: [
    {
      id: 'tpl-1',
      fileStem: 'Hello',
      labelKey: 'templates.tpl-1.label',
      descriptionKey: 'templates.tpl-1.description',
      language: 'javascript',
      code: '',
    },
    {
      id: 'tpl-2',
      fileStem: 'World',
      labelKey: 'templates.tpl-2.label',
      descriptionKey: 'templates.tpl-2.description',
      language: 'typescript',
      code: '',
    },
  ],
  resolveTemplateFileStem: (tpl: { fileStem: string }) => tpl.fileStem,
  resolveTemplateLabel: (tpl: { id: string }) => (tpl.id === 'tpl-1' ? 'Hola' : 'Mundo'),
  resolveTemplateDescription: () => 'desc',
}));

vi.mock('../../src/renderer/components/ui/chrome', () => ({
  Kbd: ({ children }: { children: React.ReactNode }) => <kbd>{children}</kbd>,
}));

import { EditorEmptyState } from '../../src/renderer/components/Editor/EditorEmptyState';

describe('EditorEmptyState', () => {
  beforeEach(async () => {
    mockAddTab.mockReset();
    await i18next.changeLanguage('en');
  });

  it('renders the localized brand label and headline from i18n', () => {
    render(<EditorEmptyState />);
    expect(screen.getByText('Developer Workbench')).toBeTruthy();
    expect(
      screen.getByText(/Run experiments fast/i)
    ).toBeTruthy();
  });

  it('renders the pluralized template count from i18n', () => {
    render(<EditorEmptyState />);
    // With 2 mock templates → "2 templates" (plural form)
    expect(screen.getByText('2 templates')).toBeTruthy();
  });

  it('opens a quick-start language when its button is clicked', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'go' })
    );
  });

  it('keeps template-generated filenames stable when labels are localized', async () => {
    const user = userEvent.setup();
    render(<EditorEmptyState />);

    await user.click(screen.getByRole('button', { name: /Hola/i }));

    expect(mockAddTab).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Hello.js', language: 'javascript' })
    );
  });

  it('renders localized empty-state copy in Spanish', async () => {
    await i18next.changeLanguage('es');

    render(<EditorEmptyState />);

    expect(screen.getByText('Estación de desarrollo')).toBeTruthy();
    expect(screen.getByText(/Ejecuta experimentos rápido/i)).toBeTruthy();
    expect(screen.getByText('Puntos de partida')).toBeTruthy();
    expect(screen.getByText('2 plantillas')).toBeTruthy();
  });
});
