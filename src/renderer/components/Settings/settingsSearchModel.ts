import type { TabId } from './settingsRailModel';

export interface SettingsSearchEntry {
  id: string;
  tab: TabId;
  labelKey: string;
  descriptionKey?: string;
  targetId: string;
  keywords: readonly string[];
}

export interface SettingsSearchResult extends SettingsSearchEntry {
  label: string;
  description: string | null;
  tabLabel: string;
}

type Translate = (key: string) => string;

const SETTINGS_SEARCH_ENTRIES: readonly SettingsSearchEntry[] = [
  {
    id: 'about',
    tab: 'general',
    labelKey: 'about.title',
    descriptionKey: 'about.description',
    targetId: 'section-about',
    keywords: ['version', 'build', 'release', 'github', 'website', 'acerca'],
  },
  {
    id: 'updates',
    tab: 'general',
    labelKey: 'updates.title',
    descriptionKey: 'updates.description',
    targetId: 'section-updates',
    keywords: ['update', 'upgrade', 'release', 'actualizacion', 'novedades'],
  },
  {
    id: 'onboarding',
    tab: 'general',
    labelKey: 'onboarding.section.title',
    descriptionKey: 'onboarding.section.hint',
    targetId: 'section-onboarding',
    keywords: ['tour', 'welcome', 'first run', 'inicio', 'bienvenida', 'tutorial'],
  },
  {
    id: 'recipe-progress',
    tab: 'general',
    labelKey: 'settings.recipes.resetTitle',
    descriptionKey: 'settings.recipes.resetDescription',
    targetId: 'section-recipe-progress',
    keywords: ['recipes', 'practice', 'reset', 'recetas', 'practica', 'progreso'],
  },
  {
    id: 'appearance',
    tab: 'appearance',
    labelKey: 'appearance.title',
    descriptionKey: 'appearance.description',
    targetId: 'section-appearance',
    keywords: ['theme', 'color', 'look', 'tema', 'color', 'interfaz'],
  },
  {
    id: 'theme-pack',
    tab: 'appearance',
    labelKey: 'settings.themePack.label',
    targetId: 'appearance-theme-pack',
    keywords: ['theme', 'preset', 'skin', 'tema', 'apariencia'],
  },
  {
    id: 'app-language',
    tab: 'appearance',
    labelKey: 'language.label',
    descriptionKey: 'language.hint',
    targetId: 'appearance-language',
    keywords: ['language', 'locale', 'english', 'spanish', 'idioma', 'espanol', 'ingles'],
  },
  {
    id: 'layout',
    tab: 'appearance',
    labelKey: 'layout.title',
    descriptionKey: 'layout.description',
    targetId: 'section-layout',
    keywords: ['split', 'panels', 'horizontal', 'vertical', 'diseno', 'paneles'],
  },
  {
    id: 'editor',
    tab: 'editor',
    labelKey: 'editor.title',
    descriptionKey: 'editor.description',
    targetId: 'section-editor',
    keywords: ['monaco', 'code', 'editing', 'codigo', 'edicion'],
  },
  {
    id: 'font-family',
    tab: 'editor',
    labelKey: 'editor.fontFamily.label',
    descriptionKey: 'editor.fontFamily.hint',
    targetId: 'editor-font-family',
    keywords: ['font', 'typeface', 'typography', 'fuente', 'tipografia'],
  },
  {
    id: 'font-size',
    tab: 'editor',
    labelKey: 'editor.fontSize.label',
    descriptionKey: 'editor.fontSize.hint',
    targetId: 'editor-font-size',
    keywords: ['font', 'size', 'zoom', 'text', 'fuente', 'tamano', 'texto'],
  },
  {
    id: 'default-runtime',
    tab: 'editor',
    labelKey: 'runtimeMode.settings.title',
    descriptionKey: 'runtimeMode.settings.description',
    targetId: 'editor-default-runtime',
    keywords: ['runtime', 'worker', 'node', 'browser', 'ejecucion', 'motor'],
  },
  {
    id: 'word-wrap',
    tab: 'editor',
    labelKey: 'editor.wordWrap.label',
    descriptionKey: 'editor.wordWrap.hint',
    targetId: 'editor-word-wrap',
    keywords: ['wrap', 'line', 'long lines', 'ajuste', 'linea'],
  },
  {
    id: 'restore-session',
    tab: 'editor',
    labelKey: 'editor.restoreSession.label',
    descriptionKey: 'editor.restoreSession.hint',
    targetId: 'editor-restore-session',
    keywords: ['session', 'tabs', 'startup', 'restore', 'sesion', 'pestanas', 'restaurar'],
  },
  {
    id: 'format-on-save',
    tab: 'editor',
    labelKey: 'editor.formatOnSave.label',
    descriptionKey: 'editor.formatOnSave.hint',
    targetId: 'editor-format-on-save',
    keywords: ['format', 'prettier', 'save', 'formato', 'guardar'],
  },
  {
    id: 'smart-paste',
    tab: 'editor',
    labelKey: 'editor.smartPaste.label',
    descriptionKey: 'editor.smartPaste.hint',
    targetId: 'editor-smart-paste',
    keywords: ['paste', 'clipboard', 'detect', 'pegar', 'portapapeles', 'detectar'],
  },
  {
    id: 'vim-mode',
    tab: 'editor',
    labelKey: 'editor.vimMode.label',
    descriptionKey: 'editor.vimMode.hint',
    targetId: 'editor-vim-mode',
    keywords: ['vim', 'modal', 'keybindings', 'teclado'],
  },
  {
    id: 'status-bar',
    tab: 'editor',
    labelKey: 'settings.editor.showStatusBar.label',
    descriptionKey: 'settings.editor.showStatusBar.hint',
    targetId: 'editor-status-bar',
    keywords: ['status', 'footer', 'bar', 'estado', 'barra'],
  },
  {
    id: 'dependency-detection',
    tab: 'editor',
    labelKey: 'settings.editor.dependencyDetection.label',
    descriptionKey: 'settings.editor.dependencyDetection.hint',
    targetId: 'editor-dependency-detection',
    keywords: ['dependency', 'package', 'imports', 'dependencia', 'paquete'],
  },
  {
    id: 'execution-history',
    tab: 'editor',
    labelKey: 'executionHistory.title',
    descriptionKey: 'executionHistory.description',
    targetId: 'section-execution-history',
    keywords: ['history', 'replay', 'runs', 'historial', 'ejecuciones'],
  },
  {
    id: 'developer-utilities',
    tab: 'editor',
    labelKey: 'utilities.settings.title',
    descriptionKey: 'utilities.settings.description',
    targetId: 'section-utilities',
    keywords: ['utilities', 'tools', 'clipboard', 'utilidades', 'herramientas'],
  },
  {
    id: 'languages',
    tab: 'languages',
    labelKey: 'settings.languages.perLanguage.title',
    descriptionKey: 'settings.languages.perLanguage.description',
    targetId: 'section-languages',
    keywords: ['language', 'lsp', 'rust', 'go', 'python', 'ruby', 'lenguaje', 'soporte'],
  },
  {
    id: 'environment',
    tab: 'environment',
    labelKey: 'envVars.title',
    descriptionKey: 'envVars.description',
    targetId: 'section-environment',
    keywords: ['env', 'variable', 'secret', 'environment', 'entorno', 'secreto'],
  },
  {
    id: 'privacy',
    tab: 'privacy',
    labelKey: 'privacy.title',
    descriptionKey: 'privacy.description',
    targetId: 'section-privacy',
    keywords: ['privacy', 'data', 'local', 'privacidad', 'datos'],
  },
  {
    id: 'telemetry',
    tab: 'privacy',
    labelKey: 'privacy.telemetry.label',
    descriptionKey: 'privacy.telemetry.hint',
    targetId: 'privacy-telemetry',
    keywords: ['telemetry', 'analytics', 'tracking', 'telemetria', 'analitica', 'rastreo'],
  },
  {
    id: 'run-ledger',
    tab: 'privacy',
    labelKey: 'privacy.runLedger.label',
    descriptionKey: 'privacy.runLedger.hint',
    targetId: 'privacy-run-ledger',
    keywords: ['ledger', 'sql', 'history', 'local', 'historial', 'registro'],
  },
  {
    id: 'privacy-trust',
    tab: 'privacy',
    labelKey: 'settings.privacy.title',
    targetId: 'section-privacy-trust',
    keywords: ['trust', 'audit', 'redaction', 'network', 'confianza', 'auditoria', 'redaccion'],
  },
  {
    id: 'license',
    tab: 'account',
    labelKey: 'license.title',
    descriptionKey: 'license.description',
    targetId: 'section-license',
    keywords: ['license', 'token', 'pro', 'trial', 'activation', 'licencia', 'activar'],
  },
  {
    id: 'ai',
    tab: 'account',
    labelKey: 'ai.settings.title',
    descriptionKey: 'ai.settings.description',
    targetId: 'section-ai',
    keywords: ['ai', 'openai', 'ollama', 'model', 'endpoint', 'api key', 'ia', 'modelo'],
  },
  {
    id: 'run-capsules',
    tab: 'account',
    labelKey: 'settings.account.runCapsules.title',
    descriptionKey: 'settings.account.runCapsules.description',
    targetId: 'section-run-capsules',
    keywords: ['capsule', 'share', 'export', 'import', 'capsula', 'compartir', 'exportar'],
  },
  {
    id: 'shortcuts',
    tab: 'shortcuts',
    labelKey: 'settings.shortcuts.eyebrow',
    descriptionKey: 'settings.shortcuts.description',
    targetId: 'section-shortcuts',
    keywords: ['keyboard', 'shortcut', 'keybinding', 'hotkey', 'teclado', 'atajo'],
  },
  {
    id: 'plugins',
    tab: 'plugins',
    labelKey: 'plugins.title',
    descriptionKey: 'plugins.description',
    targetId: 'section-plugins',
    keywords: ['plugin', 'extension', 'package', 'complemento', 'extension'],
  },
  {
    id: 'recovery',
    tab: 'recovery',
    labelKey: 'recovery.title',
    descriptionKey: 'recovery.description',
    targetId: 'section-recovery',
    keywords: ['recovery', 'reset', 'backup', 'restore', 'recuperar', 'respaldo', 'restaurar'],
  },
];

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function searchSettings(
  query: string,
  t: Translate
): SettingsSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

  return SETTINGS_SEARCH_ENTRIES.flatMap((entry, index) => {
    const label = t(entry.labelKey);
    const description = entry.descriptionKey ? t(entry.descriptionKey) : null;
    const tabLabel = t(`settings.tabs.${entry.tab}`);
    const normalizedLabel = normalizeSearchText(label);
    const normalizedKeywords = entry.keywords.map(normalizeSearchText);
    const haystack = [
      normalizedLabel,
      normalizeSearchText(description ?? ''),
      normalizeSearchText(tabLabel),
      ...normalizedKeywords,
    ].join(' ');

    if (!tokens.every(token => haystack.includes(token))) {
      return [];
    }

    const score =
      normalizedLabel === normalizedQuery
        ? 0
        : normalizedLabel.startsWith(normalizedQuery)
          ? 1
          : normalizedLabel.includes(normalizedQuery)
            ? 2
            : normalizedKeywords.some(keyword => keyword.includes(normalizedQuery))
              ? 3
              : 4;

    return [
      {
        ...entry,
        label,
        description,
        tabLabel,
        score,
        index,
      },
    ];
  })
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ score: _score, index: _index, ...result }) => result);
}
