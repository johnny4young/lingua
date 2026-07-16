export type HintSurface = 'console' | 'palette';
export type HintPlatform = 'web' | 'desktop';

export interface ContextualHintEntry {
  readonly id: string;
  readonly i18nKey: string;
  readonly surface: HintSurface;
  /** Omitted means the feature is compiled on both web and desktop. */
  readonly platform?: HintPlatform;
}

/**
 * Closed product-tip catalog. Every entry points at a capability that exists
 * today; platform-limited entries are filtered before selection so web never
 * advertises native runtimes or filesystem-only project scaffolding.
 */
export const CONTEXTUAL_HINTS: readonly ContextualHintEntry[] = [
  { id: 'console-run', i18nKey: 'hints.console.run', surface: 'console' },
  { id: 'console-watch', i18nKey: 'hints.console.watch', surface: 'console' },
  { id: 'console-auto-log', i18nKey: 'hints.console.autoLog', surface: 'console' },
  { id: 'console-filters', i18nKey: 'hints.console.filters', surface: 'console' },
  { id: 'console-timestamps', i18nKey: 'hints.console.timestamps', surface: 'console' },
  { id: 'console-image-paste', i18nKey: 'hints.console.imagePaste', surface: 'console' },
  { id: 'console-source-links', i18nKey: 'hints.console.sourceLinks', surface: 'console' },
  { id: 'console-rich-output', i18nKey: 'hints.console.richOutput', surface: 'console' },
  { id: 'console-clear-undo', i18nKey: 'hints.console.clearUndo', surface: 'console' },
  { id: 'console-toggle', i18nKey: 'hints.console.toggle', surface: 'console' },
  { id: 'palette-search', i18nKey: 'hints.palette.search', surface: 'palette' },
  { id: 'palette-quick-open', i18nKey: 'hints.palette.quickOpen', surface: 'palette' },
  { id: 'palette-symbols', i18nKey: 'hints.palette.symbols', surface: 'palette' },
  { id: 'palette-plain-paste', i18nKey: 'hints.palette.plainPaste', surface: 'palette' },
  { id: 'palette-utilities', i18nKey: 'hints.palette.utilities', surface: 'palette' },
  { id: 'palette-import', i18nKey: 'hints.palette.import', surface: 'palette' },
  { id: 'palette-recipes', i18nKey: 'hints.palette.recipes', surface: 'palette' },
  { id: 'palette-settings', i18nKey: 'hints.palette.settings', surface: 'palette' },
  {
    id: 'palette-go-desktop',
    i18nKey: 'hints.palette.goDesktop',
    surface: 'palette',
    platform: 'desktop',
  },
  {
    id: 'palette-project-templates-desktop',
    i18nKey: 'hints.palette.projectTemplatesDesktop',
    surface: 'palette',
    platform: 'desktop',
  },
];

function createSessionSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  }
  return Date.now() >>> 0;
}

const sessionSeed = createSessionSeed();

export function currentHintPlatform(): HintPlatform {
  if (
    typeof window === 'undefined' ||
    window.lingua?.platform === undefined ||
    window.lingua.platform === 'web'
  ) {
    return 'web';
  }
  return 'desktop';
}

export function hintsForSurface(
  surface: HintSurface,
  platform: HintPlatform
): readonly ContextualHintEntry[] {
  return CONTEXTUAL_HINTS.filter(
    hint => hint.surface === surface && (hint.platform === undefined || hint.platform === platform)
  );
}

/** Stable inside one app session; explicit seeds keep unit tests deterministic. */
export function selectContextualHint(
  surface: HintSurface,
  seed: number = sessionSeed,
  platform: HintPlatform = currentHintPlatform()
): ContextualHintEntry | null {
  const available = hintsForSurface(surface, platform);
  if (available.length === 0) return null;
  const normalizedSeed = Math.abs(Math.trunc(Number.isFinite(seed) ? seed : 0));
  return available[normalizedSeed % available.length] ?? null;
}
