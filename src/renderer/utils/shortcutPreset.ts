import {
  KEYBOARD_SHORTCUTS,
  comboKey,
  isEditableShortcutCombo,
  type ShortcutCombo,
  type ShortcutOverrideMap,
} from '../data/keyboardShortcuts';

export const SHORTCUT_PRESET_VERSION = 1;
const SUPPORTED_PRESET_VERSIONS: readonly number[] = [1];

export type ShortcutPresetParseFailure =
  | 'invalid-json'
  | 'invalid-shape'
  | 'unsupported-version';

export interface ShortcutPreset {
  version: number;
  /** Optional human label so shared files stay readable in a diff. */
  name?: string;
  overrides: ShortcutOverrideMap;
}

export type ParseShortcutPresetResult =
  | { ok: true; preset: ShortcutPreset }
  | { ok: false; reason: ShortcutPresetParseFailure; message?: string };

const MAX_TOKENS_PER_COMBO = 5;
const MAX_COMBOS_PER_SHORTCUT = 4;

/** Snapshot the current override map into a serializable preset bundle. */
export function buildShortcutPreset(overrides: ShortcutOverrideMap, name?: string): ShortcutPreset {
  return {
    version: SHORTCUT_PRESET_VERSION,
    name,
    overrides: { ...overrides },
  };
}

export function serializeShortcutPreset(preset: ShortcutPreset): string {
  return JSON.stringify(preset, null, 2) + '\n';
}

/**
 * Validate combos coming off disk. Unknown shortcut ids, malformed tokens,
 * oversized arrays, and non-editable combos (e.g. a raw `J` with no modifier)
 * are dropped — we match the same shape that `settingsStore.sanitize…` uses
 * so disk-round-tripping stays lossless.
 */
function sanitizeParsedOverrides(raw: unknown): ShortcutOverrideMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawRecord = raw as Record<string, unknown>;
  const out: Record<string, readonly ShortcutCombo[]> = {};
  const claimedCombos = new Set<string>();

  for (const shortcut of KEYBOARD_SHORTCUTS) {
    const rawCombos = rawRecord[shortcut.id];
    if (!Array.isArray(rawCombos)) continue;
    const combos: ShortcutCombo[] = [];
    for (const rawCombo of rawCombos.slice(0, MAX_COMBOS_PER_SHORTCUT)) {
      if (!rawCombo || typeof rawCombo !== 'object') continue;
      const tokens = (rawCombo as { tokens?: unknown }).tokens;
      if (!Array.isArray(tokens)) continue;
      if (tokens.length === 0 || tokens.length > MAX_TOKENS_PER_COMBO) continue;
      if (
        !tokens.every(
          (token) => typeof token === 'string' && token.length > 0 && token.length <= 32
        )
      ) {
        continue;
      }
      const combo: ShortcutCombo = { tokens: tokens as readonly string[] };
      if (!isEditableShortcutCombo(combo)) continue;
      const key = comboKey(combo);
      if (claimedCombos.has(key)) continue;
      claimedCombos.add(key);
      combos.push(combo);
    }
    if (combos.length > 0) out[shortcut.id] = combos;
  }
  return out;
}

export function parseShortcutPreset(raw: string): ParseShortcutPresetResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    return { ok: false, reason: 'invalid-json', message };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'invalid-shape' };
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.version !== 'number' ||
    !SUPPORTED_PRESET_VERSIONS.includes(candidate.version)
  ) {
    return {
      ok: false,
      reason: 'unsupported-version',
      message:
        typeof candidate.version === 'number'
          ? `Got version ${candidate.version}`
          : 'Missing version field',
    };
  }

  const overrides = sanitizeParsedOverrides(candidate.overrides);
  if (!overrides) return { ok: false, reason: 'invalid-shape' };

  const name = typeof candidate.name === 'string' ? candidate.name : undefined;

  return {
    ok: true,
    preset: {
      version: SHORTCUT_PRESET_VERSION,
      name,
      overrides,
    },
  };
}
