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
    const urlParserAction = withUtilities.find(
      (c) => c.id === 'action-developer-utility-url-parser'
    );

    // Count reflects the DeveloperUtilities catalog length. Bumps when a
    // new utility id is added. The most recent bumps: number-base,
    // beautify-minify, url-parser, string-case, html-entity,
    // string-inspector, qr-code, backslash-escape, random-string,
    // base64-image, lorem-ipsum, svg-to-css, cron-parser, html-to-jsx,
    // curl-to-code, plus the RL-068 closeout bundle (yaml-json,
    // json-csv, markdown-preview, sql-formatter) — now 29.
    expect(withUtilities.filter((c) => c.id.startsWith('action-developer-utility-'))).toHaveLength(29);
    expect(jsonAction?.label).toBe('Open JSON Formatter');
    expect(urlParserAction?.label).toBe('Open URL Parser');
    expect(urlParserAction?.description).toContain('scheme, host, path, query, and fragment');
    expect(filterCommandPaletteCommands(withUtilities, 'inspect')).toContain(urlParserAction);

    jsonAction?.action();
    urlParserAction?.action();
    expect(onOpenDeveloperUtility).toHaveBeenCalledWith('json');
    expect(onOpenDeveloperUtility).toHaveBeenCalledWith('url-parser');

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

  it('keeps the URL Parser palette action discoverable after switching to Spanish', async () => {
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
        onOpenDeveloperUtility: vi.fn(),
        checkForUpdates: vi.fn().mockResolvedValue(undefined),
        restartToApply: vi.fn().mockResolvedValue(true),
        t: i18next.t.bind(i18next),
      });

      const urlParserAction = commands.find(
        (command) => command.id === 'action-developer-utility-url-parser'
      );
      expect(urlParserAction?.label).toBe('Abrir analizador de URL');
      expect(filterCommandPaletteCommands(commands, 'analizador')).toContain(urlParserAction);
      expect(filterCommandPaletteCommands(commands, 'inspect')).toContain(urlParserAction);
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('exposes the keyboard shortcuts action only when the opener is wired in', () => {
    const onOpenKeyboardShortcuts = vi.fn();
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
      buildCommandPaletteModel(baseArgs).find((c) => c.id === 'action-keyboard-shortcuts')
    ).toBeUndefined();

    const withShortcuts = buildCommandPaletteModel({
      ...baseArgs,
      onOpenKeyboardShortcuts,
    });
    const action = withShortcuts.find((c) => c.id === 'action-keyboard-shortcuts');
    expect(action).toBeDefined();
    expect(action?.label).toBe('Open Keyboard Shortcuts');
    action?.action();
    expect(onOpenKeyboardShortcuts).toHaveBeenCalledOnce();
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

describe('buildCommandPaletteModel — recent runs (RL-028 third slice)', () => {
  function buildWithHistory(
    history: Array<{
      id: string;
      language: string;
      status: 'ok' | 'error';
      durationMs: number | null;
      timestamp: number;
    }>,
    onFocusLanguageTab?: (language: string) => void
  ) {
    return buildCommandPaletteModel({
      templates: [],
      snippets: [],
      executionHistory: history,
      onFocusLanguageTab,
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
  }

  it('returns no recent-run entries when the history is empty', () => {
    const commands = buildWithHistory([]);
    expect(commands.filter((c) => c.id.startsWith('recent-run-'))).toEqual([]);
  });

  it('caps the recent-run entries at 5 and keeps them newest-first', () => {
    const history = Array.from({ length: 7 }, (_, i) => ({
      id: `e${i}`,
      language: 'javascript',
      status: 'ok' as const,
      durationMs: i,
      timestamp: 1_700_000_000_000 + i * 1000,
    }));
    const commands = buildWithHistory(history);
    const recent = commands.filter((c) => c.id.startsWith('recent-run-'));
    expect(recent).toHaveLength(5);
    // Newest entry (e6) must come first, oldest kept (e2) last.
    expect(recent[0]?.id).toBe('recent-run-e6');
    expect(recent[4]?.id).toBe('recent-run-e2');
  });

  it('includes language, status, and duration in the label for discoverability', () => {
    const commands = buildWithHistory([
      {
        id: 'entry-rust',
        language: 'rust',
        status: 'error',
        durationMs: 42,
        timestamp: 0,
      },
    ]);
    const entry = commands.find((c) => c.id === 'recent-run-entry-rust');
    expect(entry).toBeDefined();
    expect(entry?.label.toLowerCase()).toContain('rust');
    expect(entry?.label.toLowerCase()).toContain('error');
    expect(entry?.label).toContain('42.0 ms');
  });

  it('formats recent-run durations with the shell helper instead of raw floats', () => {
    const commands = buildWithHistory([
      {
        id: 'entry-float',
        language: 'javascript',
        status: 'ok',
        durationMs: 0.2749999761581421,
        timestamp: 0,
      },
    ]);
    const entry = commands.find((c) => c.id === 'recent-run-entry-float');
    expect(entry).toBeDefined();
    expect(entry?.label).toContain('0.3 ms');
    expect(entry?.label).not.toContain('0.2749999761581421');
  });

  it('describes recent-run actions as language-level tab focus, not exact replay', () => {
    const commands = buildWithHistory([
      {
        id: 'entry-js',
        language: 'javascript',
        status: 'ok',
        durationMs: 5,
        timestamp: 0,
      },
    ]);
    const entry = commands.find((c) => c.id === 'recent-run-entry-js');
    expect(entry).toBeDefined();
    expect(entry?.description.toLowerCase()).toContain('open tab');
    expect(entry?.description.toLowerCase()).not.toContain('last ran');
  });

  it('calls onFocusLanguageTab with the entry language when the action fires', () => {
    const focus = vi.fn();
    const commands = buildWithHistory(
      [
        {
          id: 'entry-py',
          language: 'python',
          status: 'ok',
          durationMs: 10,
          timestamp: 0,
        },
      ],
      focus
    );
    commands.find((c) => c.id === 'recent-run-entry-py')?.action();
    expect(focus).toHaveBeenCalledWith('python');
  });
});

describe('buildCommandPaletteModel — re-run last action (RL-028 fourth slice)', () => {
  function buildWith(onRerunLast?: () => void) {
    return buildCommandPaletteModel({
      templates: [],
      snippets: [],
      onRerunLast,
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
  }

  it('hides the action when no onRerunLast callback is supplied', () => {
    const commands = buildWith();
    expect(commands.find((c) => c.id === 'action-rerun-last')).toBeUndefined();
  });

  it('exposes the action when onRerunLast is wired and fires the callback on activation', () => {
    const rerun = vi.fn();
    const commands = buildWith(rerun);
    const action = commands.find((c) => c.id === 'action-rerun-last');
    expect(action).toBeDefined();
    expect(action?.label.toLowerCase()).toContain('re-run');
    expect(action?.keywords).toEqual(
      expect.arrayContaining(['rerun', 'replay', 'last', 'recent', 'run'])
    );
    action?.action();
    expect(rerun).toHaveBeenCalledTimes(1);
  });

  it('localizes the rerun label in Spanish', async () => {
    await i18next.changeLanguage('es');
    try {
      const commands = buildWith(() => {});
      const action = commands.find((c) => c.id === 'action-rerun-last');
      expect(action?.label).toBe('Volver a ejecutar lo último');
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});

describe('buildCommandPaletteModel — per-entry replay (RL-028 sixth slice trailer)', () => {
  type HistoryEntry = {
    id: string;
    language: string;
    status: 'ok' | 'error';
    durationMs: number | null;
    timestamp: number;
    snapshot: { code: string; language: string; truncated: boolean } | null;
  };

  function buildWithReplay(
    history: HistoryEntry[],
    onReplayEntry?: (entry: HistoryEntry) => void
  ) {
    return buildCommandPaletteModel({
      templates: [],
      snippets: [],
      executionHistory: history,
      onReplayEntry: onReplayEntry as Parameters<
        typeof buildCommandPaletteModel
      >[0]['onReplayEntry'],
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
  }

  function makeEntry(
    id: string,
    snapshot: HistoryEntry['snapshot'],
    overrides?: Partial<HistoryEntry>
  ): HistoryEntry {
    return {
      id,
      language: 'javascript',
      status: 'ok',
      durationMs: 12,
      timestamp: 1_700_000_000_000,
      snapshot,
      ...overrides,
    };
  }

  it('emits no replay commands when onReplayEntry is not wired', () => {
    const commands = buildWithReplay([
      makeEntry('e1', { code: 'x', language: 'javascript', truncated: false }),
    ]);
    expect(commands.filter((c) => c.id.startsWith('action-replay-'))).toEqual([]);
  });

  it('emits no replay commands when no entry has a snapshot', () => {
    const commands = buildWithReplay(
      [makeEntry('e1', null), makeEntry('e2', null)],
      vi.fn()
    );
    expect(commands.filter((c) => c.id.startsWith('action-replay-'))).toEqual([]);
  });

  it('emits one replay command per snapshot-bearing entry, newest-first, capped at 5', () => {
    const history: HistoryEntry[] = Array.from({ length: 7 }, (_, i) =>
      makeEntry(`e${i}`, {
        code: `entry-${i}`,
        language: 'javascript',
        truncated: false,
      }),
    );
    const commands = buildWithReplay(history, vi.fn());
    const replays = commands.filter((c) => c.id.startsWith('action-replay-'));
    expect(replays).toHaveLength(5);
    expect(replays[0]?.id).toBe('action-replay-e6');
    expect(replays[4]?.id).toBe('action-replay-e2');
  });

  it('skips metadata-only entries inside the cap-5 recent-history window', () => {
    const history: HistoryEntry[] = [
      makeEntry('keep-1', { code: 'a', language: 'javascript', truncated: false }),
      makeEntry('skip-2', null),
      makeEntry('keep-3', { code: 'b', language: 'javascript', truncated: false }),
      makeEntry('skip-4', null),
      makeEntry('keep-5', { code: 'c', language: 'javascript', truncated: false }),
    ];
    const commands = buildWithReplay(history, vi.fn());
    const replays = commands.filter((c) => c.id.startsWith('action-replay-'));
    expect(replays.map((c) => c.id)).toEqual([
      'action-replay-keep-5',
      'action-replay-keep-3',
      'action-replay-keep-1',
    ]);
  });

  it('does not backfill stale snapshots from outside the cap-5 recent-history window', () => {
    const history: HistoryEntry[] = [
      makeEntry('stale-1', { code: 'a', language: 'javascript', truncated: false }),
      makeEntry('stale-2', { code: 'b', language: 'javascript', truncated: false }),
      makeEntry('skip-3', null),
      makeEntry('skip-4', null),
      makeEntry('skip-5', null),
      makeEntry('skip-6', null),
      makeEntry('keep-7', { code: 'c', language: 'javascript', truncated: false }),
    ];
    const commands = buildWithReplay(history, vi.fn());
    const replays = commands.filter((c) => c.id.startsWith('action-replay-'));
    expect(replays.map((c) => c.id)).toEqual(['action-replay-keep-7']);
  });

  it('label includes language, status, and duration; description matches the action', () => {
    const commands = buildWithReplay(
      [
        makeEntry(
          'entry-rust',
          { code: 'fn main() {}', language: 'rust', truncated: false },
          { language: 'rust', status: 'error', durationMs: 42 },
        ),
      ],
      vi.fn(),
    );
    const replay = commands.find((c) => c.id === 'action-replay-entry-rust');
    expect(replay).toBeDefined();
    expect(replay?.label.toLowerCase()).toContain('rust');
    expect(replay?.label.toLowerCase()).toContain('error');
    expect(replay?.label).toContain('42.0 ms');
    expect(replay?.description.toLowerCase()).toContain('captured code');
  });

  it('keywords include replay, snapshot, history, reproduce', () => {
    const commands = buildWithReplay(
      [makeEntry('e1', { code: 'x', language: 'javascript', truncated: false })],
      vi.fn(),
    );
    const replay = commands.find((c) => c.id === 'action-replay-e1');
    expect(replay?.keywords).toEqual(
      expect.arrayContaining(['replay', 'snapshot', 'history', 'reproduce']),
    );
  });

  it('activation calls onReplayEntry exactly once with the right entry, then closes the palette', () => {
    const onReplay = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry('e1', {
      code: 'console.log(1)',
      language: 'javascript',
      truncated: false,
    });
    const commands = buildCommandPaletteModel({
      templates: [],
      snippets: [],
      executionHistory: [entry],
      onReplayEntry: onReplay as Parameters<
        typeof buildCommandPaletteModel
      >[0]['onReplayEntry'],
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
      onClose,
      onOpenSettings: vi.fn(),
      onOpenWhatsNew: vi.fn(),
      onStartGuidedTour: vi.fn(),
      onOpenSnippets: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      restartToApply: vi.fn().mockResolvedValue(true),
      t: i18next.t.bind(i18next),
    });
    commands.find((c) => c.id === 'action-replay-e1')?.action();
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onReplay).toHaveBeenCalledWith(entry);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('localizes the replay label in Spanish (tuteo)', async () => {
    await i18next.changeLanguage('es');
    try {
      const commands = buildWithReplay(
        [
          makeEntry('e1', {
            code: 'console.log(1)',
            language: 'javascript',
            truncated: false,
          }),
        ],
        vi.fn(),
      );
      const replay = commands.find((c) => c.id === 'action-replay-e1');
      expect(replay?.label).toContain('Reproduce la ejecución');
      expect(replay?.description).toContain('código guardado');
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});
