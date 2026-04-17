import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { BUILT_IN_TEMPLATES } from '../../src/renderer/data/templates';
import type { Snippet } from '../../src/renderer/stores/snippetsStore';
import {
  buildCommandPaletteModel,
  filterCommandPaletteCommands,
} from '../../src/renderer/components/CommandPalette/commandPaletteModel';

describe('buildCommandPaletteModel', () => {
  it('includes template, snippet, and action commands with stable metadata', () => {
    const createTab = vi.fn();
    const setLayoutPreset = vi.fn();
    const onClose = vi.fn();
    const onOpenSettings = vi.fn();
    const onOpenWhatsNew = vi.fn();
    const onStartGuidedTour = vi.fn();
    const onOpenSnippets = vi.fn();
    const checkForUpdates = vi.fn().mockResolvedValue(undefined);
    const restartToApply = vi.fn().mockResolvedValue(true);

    const snippets: Snippet[] = [
      {
        id: 'snippet-1',
        label: 'Fetch helper',
        description: 'Reusable fetch wrapper',
        language: 'typescript',
        code: 'export async function fetcher() {}',
        createdAt: 1,
      },
    ];

    const commands = buildCommandPaletteModel({
      templates: BUILT_IN_TEMPLATES.slice(0, 1),
      snippets,
      updateStatus: 'downloaded',
      createTab,
      createDefaultTab: (language) => ({
        id: `tab-${language}`,
        name: `untitled-${language}`,
        language,
        content: '',
        isDirty: false,
      }),
      setLayoutPreset,
      onClose,
      onOpenSettings,
      onOpenWhatsNew,
      onStartGuidedTour,
      onOpenSnippets,
      checkForUpdates,
      restartToApply,
      t: i18next.t.bind(i18next),
    });

    expect(commands.some((command) => command.category === 'template')).toBe(true);
    expect(commands.some((command) => command.category === 'snippet')).toBe(true);
    expect(commands.some((command) => command.id === 'action-about')).toBe(true);
    expect(commands.some((command) => command.id === 'action-whats-new')).toBe(true);
    expect(commands.some((command) => command.id === 'action-guided-tour')).toBe(true);
    expect(commands.some((command) => command.id === 'action-settings')).toBe(true);

    const templateCommand = commands.find((command) => command.category === 'template');
    const snippetCommand = commands.find((command) => command.category === 'snippet');
    const restartCommand = commands.find(
      (command) => command.id === 'action-restart-update'
    );

    expect(templateCommand?.keywords).toContain(templateCommand?.label.toLowerCase());
    expect(snippetCommand?.keywords).toContain('reusable fetch wrapper');
    expect(restartCommand?.description).toContain('Restart now');
  });

  it('translates action labels through the provided t function', async () => {
    await i18next.changeLanguage('es');
    try {
      const commands = buildCommandPaletteModel({
        templates: [],
        snippets: [],
        updateStatus: 'idle',
        createTab: vi.fn(),
        createDefaultTab: (language) => ({
          id: `tab-${language}`,
          name: `untitled-${language}`,
          language,
          content: '',
          isDirty: false,
        }),
        setLayoutPreset: vi.fn(),
        onClose: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenWhatsNew: vi.fn(),
        onStartGuidedTour: vi.fn(),
        onOpenSnippets: vi.fn(),
        checkForUpdates: vi.fn().mockResolvedValue(undefined),
        restartToApply: vi.fn().mockResolvedValue(true),
        t: i18next.t.bind(i18next),
      });

      const settingsCommand = commands.find((c) => c.id === 'action-settings');
      const aboutCommand = commands.find((c) => c.id === 'action-about');
      const whatsNewCommand = commands.find((c) => c.id === 'action-whats-new');
      const guidedTourCommand = commands.find((c) => c.id === 'action-guided-tour');
      expect(aboutCommand?.label).toBe('Acerca de Lingua');
      expect(whatsNewCommand?.label).toBe('Novedades');
      expect(guidedTourCommand?.label).toBe('Iniciar tour guiado');
      expect(settingsCommand?.label).toBe('Abrir configuración');
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('keeps template command filenames stable while localizing visible labels', async () => {
    await i18next.changeLanguage('es');
    try {
      const createTab = vi.fn();
      const commands = buildCommandPaletteModel({
        templates: BUILT_IN_TEMPLATES.slice(0, 1),
        snippets: [],
        updateStatus: 'idle',
        createTab,
        createDefaultTab: (language) => ({
          id: `tab-${language}`,
          name: `untitled-${language}`,
          language,
          content: '',
          isDirty: false,
        }),
        setLayoutPreset: vi.fn(),
        onClose: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenWhatsNew: vi.fn(),
        onStartGuidedTour: vi.fn(),
        onOpenSnippets: vi.fn(),
        checkForUpdates: vi.fn().mockResolvedValue(undefined),
        restartToApply: vi.fn().mockResolvedValue(true),
        t: i18next.t.bind(i18next),
      });

      const templateCommand = commands.find((command) => command.category === 'template');
      expect(templateCommand?.label).toBe('Hola mundo');

      templateCommand?.action();

      expect(createTab).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Hello World.js', language: 'javascript' })
      );
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('indexes templates by the English file stem so they stay findable across locales', async () => {
    await i18next.changeLanguage('es');
    try {
      const commands = buildCommandPaletteModel({
        templates: BUILT_IN_TEMPLATES.slice(0, 1),
        snippets: [],
        updateStatus: 'idle',
        createTab: vi.fn(),
        createDefaultTab: (language) => ({
          id: `tab-${language}`,
          name: `untitled-${language}`,
          language,
          content: '',
          isDirty: false,
        }),
        setLayoutPreset: vi.fn(),
        onClose: vi.fn(),
        onOpenSettings: vi.fn(),
        onOpenWhatsNew: vi.fn(),
        onStartGuidedTour: vi.fn(),
        onOpenSnippets: vi.fn(),
        checkForUpdates: vi.fn().mockResolvedValue(undefined),
        restartToApply: vi.fn().mockResolvedValue(true),
        t: i18next.t.bind(i18next),
      });

      const [templateCommand] = commands;
      expect(templateCommand?.keywords).toContain('hello world');
      expect(templateCommand?.keywords).toContain('hola mundo');
      expect(filterCommandPaletteCommands(commands, 'hello')).toContain(templateCommand);
      expect(filterCommandPaletteCommands(commands, 'hola')).toContain(templateCommand);
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('exposes the go-to-symbol action only when the opener is wired in', () => {
    const onOpenGoToSymbol = vi.fn();
    const baseArgs = {
      templates: [],
      snippets: [],
      updateStatus: 'idle' as const,
      createTab: vi.fn(),
      createDefaultTab: (language: string) => ({
        id: `tab-${language}`,
        name: `untitled-${language}`,
        language,
        content: '',
        isDirty: false,
      }),
      setLayoutPreset: vi.fn(),
      onClose: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWhatsNew: vi.fn(),
      onStartGuidedTour: vi.fn(),
      onOpenSnippets: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      restartToApply: vi.fn().mockResolvedValue(true),
      t: i18next.t.bind(i18next),
    };

    expect(
      buildCommandPaletteModel(baseArgs).find((c) => c.id === 'action-go-to-symbol')
    ).toBeUndefined();

    const withSymbol = buildCommandPaletteModel({ ...baseArgs, onOpenGoToSymbol });
    const action = withSymbol.find((c) => c.id === 'action-go-to-symbol');
    expect(action).toBeDefined();
    action?.action();
    expect(onOpenGoToSymbol).toHaveBeenCalledOnce();
  });

  it('exposes the project search action only when the opener is wired in', () => {
    const onOpenProjectSearch = vi.fn();
    const baseArgs = {
      templates: [],
      snippets: [],
      updateStatus: 'idle' as const,
      createTab: vi.fn(),
      createDefaultTab: (language: string) => ({
        id: `tab-${language}`,
        name: `untitled-${language}`,
        language,
        content: '',
        isDirty: false,
      }),
      setLayoutPreset: vi.fn(),
      onClose: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWhatsNew: vi.fn(),
      onStartGuidedTour: vi.fn(),
      onOpenSnippets: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      restartToApply: vi.fn().mockResolvedValue(true),
      t: i18next.t.bind(i18next),
    };

    const withoutSearch = buildCommandPaletteModel(baseArgs);
    expect(withoutSearch.find((c) => c.id === 'action-project-search')).toBeUndefined();

    const withSearch = buildCommandPaletteModel({
      ...baseArgs,
      onOpenProjectSearch,
    });
    const action = withSearch.find((c) => c.id === 'action-project-search');
    expect(action).toBeDefined();
    action?.action();
    expect(onOpenProjectSearch).toHaveBeenCalledOnce();
  });

  it('exposes developer utility actions only when the opener is wired in', () => {
    const onOpenDeveloperUtility = vi.fn();
    const baseArgs = {
      templates: [],
      snippets: [],
      updateStatus: 'idle' as const,
      createTab: vi.fn(),
      createDefaultTab: (language: string) => ({
        id: `tab-${language}`,
        name: `untitled-${language}`,
        language,
        content: '',
        isDirty: false,
      }),
      setLayoutPreset: vi.fn(),
      onClose: vi.fn(),
      onOpenSettings: vi.fn(),
      onOpenWhatsNew: vi.fn(),
      onStartGuidedTour: vi.fn(),
      onOpenSnippets: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      restartToApply: vi.fn().mockResolvedValue(true),
      t: i18next.t.bind(i18next),
    };

    expect(
      buildCommandPaletteModel(baseArgs).find((c) => c.id === 'action-developer-utility-json')
    ).toBeUndefined();

    const withUtilities = buildCommandPaletteModel({
      ...baseArgs,
      onOpenDeveloperUtility,
    });
    const jsonAction = withUtilities.find((c) => c.id === 'action-developer-utility-json');

    expect(withUtilities.filter((c) => c.id.startsWith('action-developer-utility-'))).toHaveLength(10);
    expect(jsonAction?.label).toBe('Open JSON Formatter');

    jsonAction?.action();
    expect(onOpenDeveloperUtility).toHaveBeenCalledWith('json');

    const regexAction = withUtilities.find(
      (c) => c.id === 'action-developer-utility-regex'
    );
    const colorAction = withUtilities.find(
      (c) => c.id === 'action-developer-utility-color'
    );
    const diffAction = withUtilities.find(
      (c) => c.id === 'action-developer-utility-diff'
    );
    expect(regexAction?.label).toBe('Open Regex Tester');
    expect(colorAction?.label).toBe('Open Color Converter');
    expect(diffAction?.label).toBe('Open Diff Viewer');
  });

  it('keeps matching commands when filtering by keywords, label, or description', () => {
    const commands = [
      {
        id: 'cmd-1',
        category: 'action' as const,
        label: 'Open Settings',
        description: 'Themes and preferences',
        keywords: ['settings', 'theme'],
        action: vi.fn(),
      },
      {
        id: 'cmd-2',
        category: 'snippet' as const,
        label: 'Array utils',
        description: 'Helpers for array transforms',
        keywords: ['snippet', 'helpers'],
        action: vi.fn(),
      },
    ];

    expect(filterCommandPaletteCommands(commands, 'theme')).toEqual([commands[0]]);
    expect(filterCommandPaletteCommands(commands, 'array')).toEqual([commands[1]]);
    expect(filterCommandPaletteCommands(commands, 'transforms')).toEqual([commands[1]]);
    expect(filterCommandPaletteCommands(commands, '')).toEqual(commands);
  });
});
