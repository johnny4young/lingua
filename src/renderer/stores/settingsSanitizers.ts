import type { SettingsState } from '../types';
import {
  KEYBOARD_SHORTCUTS,
  isEditableShortcutCombo,
  type ShortcutCombo,
  type ShortcutOverrideMap,
} from '../data/keyboardShortcuts';
import { type ThemePackAppearance } from '../data/themePacks';
import {
  isWorkflowMode,
  supportsWorkflowMode,
  type WorkflowMode,
} from '../../shared/workflowMode';
import {
  isRuntimeTimeoutPreset,
  isRuntimeTimeoutSupportedLanguage,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import {
  APP_LANGUAGES,
  BASELINE_SENSITIVE_HEADERS_LC,
  MAX_COMBOS_PER_SHORTCUT,
  MAX_TOKENS_PER_COMBO,
  INLINE_LINT_DEFAULT_SEED,
  SETTINGS_AUTO_LOG_LANGUAGE_SET,
  SETTINGS_INLINE_LINT_LANGUAGE_SET,
  SETTINGS_WORKFLOW_MODE_LANGUAGE_SET,
} from './settingsDefaults';

/**
 * RL-129 — settings rehydrate/runtime sanitizers, extracted verbatim from
 * `settingsStore.ts`. The long-lived `lingua-settings` localStorage boundary
 * treats every persisted value as untrusted: each function narrows a
 * tamper/forward-version-drift value to a safe shape before it can reach the
 * live store, Settings UI, runtime dispatch, or telemetry. Leaf module —
 * depends only on `settingsDefaults` + shared contracts, never on the store,
 * persistence, or action factories.
 *
 * The three `sanitize{SensitiveHttpHeaders,SqlRowDisplayLimit,SqlQueryTimeoutMs}`
 * helpers were inline IIFEs inside `merge`; they are pulled out here so all
 * rehydrate sanitization lives together and `settingsMerge` stays focused on
 * orchestration. Behavior is identical to the prior inline blocks.
 */

/**
 * RL-020 Slice 7 — sanitize a persisted
 * `runtimeTimeoutPresetByLanguage` map: drop languages outside the
 * Slice-7 supported set; drop non-enum preset tokens. Returns a
 * fresh object so callers can hand it to the store without
 * aliasing.
 */
export function sanitizeRuntimeTimeoutPresets(
  value: unknown
): Record<string, RuntimeTimeoutPreset> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, RuntimeTimeoutPreset> = {};
  for (const [language, raw] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!isRuntimeTimeoutSupportedLanguage(language)) continue;
    if (!isRuntimeTimeoutPreset(raw)) continue;
    out[language] = raw;
  }
  return out;
}

/**
 * Sanitize a persisted `scratchpadAutoLogByLanguage` map: drop
 * languages outside the JS / TS pair, coerce non-boolean values to
 * `false`. Returns a fresh object so callers can hand it directly
 * to the store without aliasing.
 */
export function sanitizeScratchpadAutoLog(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, boolean> = {};
  for (const [language, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SETTINGS_AUTO_LOG_LANGUAGE_SET.has(language)) continue;
    out[language] = raw === true;
  }
  return out;
}

/**
 * RL-108 — resolve a persisted `inlineLintEnabledByLanguage` map on rehydrate:
 * drop languages outside the supported set, drop non-boolean values, then
 * re-seed missing keys (default ON for JS/TS) so a returning user keeps live
 * lint while a persisted `false` still wins. Returns a fresh object.
 */
export function resolveInlineLintByLanguage(value: unknown): Record<string, boolean> {
  const sanitized: Record<string, boolean> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [language, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!SETTINGS_INLINE_LINT_LANGUAGE_SET.has(language)) continue;
      if (typeof raw !== 'boolean') continue;
      sanitized[language] = raw;
    }
  }
  return { ...INLINE_LINT_DEFAULT_SEED, ...sanitized };
}

/**
 * Sanitize a persisted `workflowModeDefaultsByLanguage` map: drop
 * languages outside the Settings surface, drop values that aren't
 * valid `WorkflowMode` strings, drop modes the language does not
 * support. Returns a fresh object so callers can hand it directly to
 * the store without aliasing.
 */
export function sanitizeWorkflowModeDefaults(
  value: unknown
): Record<string, WorkflowMode> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, WorkflowMode> = {};
  for (const [language, rawMode] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!SETTINGS_WORKFLOW_MODE_LANGUAGE_SET.has(language)) continue;
    if (!isWorkflowMode(rawMode)) continue;
    if (!supportsWorkflowMode(language, rawMode)) continue;
    out[language] = rawMode;
  }
  return out;
}

export function isAppLanguage(value: unknown): value is SettingsState['language'] {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

export function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * Exact equality check used only for preset normalization. A persisted
 * `keymapPreset` should remain selected only while the sanitized override map
 * still matches the preset bundle byte-for-byte; any manual edit downgrades
 * the visible selector to `default` / custom.
 */
export function shortcutOverridesEqual(
  left: ShortcutOverrideMap,
  right: ShortcutOverrideMap
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const leftKey = leftKeys[index];
    const rightKey = rightKeys[index];
    if (!leftKey || !rightKey) return false;
    if (leftKey !== rightKey) return false;
    const leftCombos = left[leftKey] ?? [];
    const rightCombos = right[rightKey] ?? [];
    if (leftCombos.length !== rightCombos.length) return false;
    for (let comboIndex = 0; comboIndex < leftCombos.length; comboIndex += 1) {
      const leftTokens = leftCombos[comboIndex]?.tokens ?? [];
      const rightTokens = rightCombos[comboIndex]?.tokens ?? [];
      if (leftTokens.length !== rightTokens.length) return false;
      for (let tokenIndex = 0; tokenIndex < leftTokens.length; tokenIndex += 1) {
        if (leftTokens[tokenIndex] !== rightTokens[tokenIndex]) {
          return false;
        }
      }
    }
  }
  return true;
}

/**
 * RL-089 — exported so the profile-import path can sanitize a
 * crafted profile's `shortcutOverrides` map before writing it to the
 * live store. The persist-middleware merge already runs this on
 * rehydrate; the import path goes around persist and would otherwise
 * leave un-validated overrides live for the rest of the session.
 */
export function sanitizeShortcutOverrides(value: unknown): ShortcutOverrideMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const knownIds = new Set(KEYBOARD_SHORTCUTS.map((entry) => entry.id));
  const out: Record<string, readonly ShortcutCombo[]> = {};
  for (const [key, rawCombos] of Object.entries(value as Record<string, unknown>)) {
    if (!knownIds.has(key)) continue;
    if (!Array.isArray(rawCombos)) continue;
    const combos: ShortcutCombo[] = [];
    for (const raw of rawCombos.slice(0, MAX_COMBOS_PER_SHORTCUT)) {
      if (!raw || typeof raw !== 'object') continue;
      const tokens = (raw as { tokens?: unknown }).tokens;
      if (!Array.isArray(tokens)) continue;
      if (tokens.length === 0 || tokens.length > MAX_TOKENS_PER_COMBO) continue;
      if (!tokens.every((token) => typeof token === 'string' && token.length > 0 && token.length <= 32)) {
        continue;
      }
      const combo = { tokens: tokens as readonly string[] };
      if (!isEditableShortcutCombo(combo)) continue;
      combos.push(combo);
    }
    if (combos.length > 0) out[key] = combos;
  }
  return out;
}

/**
 * Theme-pack normalization mirror for appearance fields. A selected pack is
 * considered active only if every pack-owned setting still equals the catalog
 * bundle; manual edits to theme, editor theme, font, size, or layout clear the
 * pack marker so Settings never shows a stale active preset.
 */
export function themePackAppearanceMatchesSettings(
  settings: Pick<
    SettingsState,
    | 'theme'
    | 'editorTheme'
    | 'fontFamily'
    | 'fontSize'
    | 'layoutPreset'
  >,
  appearance: ThemePackAppearance
): boolean {
  return (
    settings.theme === appearance.theme &&
    settings.editorTheme === appearance.editorTheme &&
    settings.fontFamily === appearance.fontFamily &&
    settings.fontSize === appearance.fontSize &&
    settings.layoutPreset === appearance.layoutPreset
  );
}

/**
 * RL-097 Slice 1 — sanitize the user's sensitive header allowlist on rehydrate:
 * drop non-string entries, empty strings, names longer than 100 chars, baseline
 * names (never persisted), and case-insensitive duplicates. (Extracted from the
 * inline `merge` IIFE.)
 */
export function sanitizeSensitiveHttpHeaders(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const lc = raw.trim().toLowerCase();
    if (lc.length === 0 || lc.length > 100) continue;
    if (BASELINE_SENSITIVE_HEADERS_LC.has(lc)) continue;
    if (seen.has(lc)) continue;
    seen.add(lc);
    result.push(lc);
  }
  return result;
}

/**
 * RL-097 Slice 2 — closed-enum row-display cap; drift falls back to 1000.
 * (Extracted from the inline `merge` IIFE.)
 */
export function sanitizeSqlRowDisplayLimit(value: unknown): 100 | 500 | 1000 | 5000 {
  if (value === 100 || value === 500 || value === 1000 || value === 5000) {
    return value;
  }
  return 1000;
}

/**
 * RL-097 Slice 2 — SQL query timeout clamp (1 s .. 5 min); non-finite falls
 * back to 30 s. (Extracted from the inline `merge` IIFE.)
 */
export function sanitizeSqlQueryTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30_000;
  return Math.min(Math.max(1_000, Math.floor(value)), 5 * 60 * 1000);
}
