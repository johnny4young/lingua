import { Download, Keyboard, RotateCcw, Search, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KEYBOARD_SHORTCUTS,
  SHORTCUT_GROUPS,
  filterShortcuts,
  findComboConflict,
  formatShortcutCombo,
  formatShortcutToken,
  isEditableShortcutCombo,
  isReservedShortcutCombo,
  keyboardEventToCombo,
  resolveCombos,
  resolveShortcutDisplayPlatform,
  type ShortcutCombo,
  type ShortcutDefinition,
  type ShortcutGroupId,
} from '../../data/keyboardShortcuts';
import { KEYMAP_PRESETS } from '../../data/keymapPresets';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import {
  buildShortcutPreset,
  parseShortcutPreset,
  serializeShortcutPreset,
  type ParseShortcutPresetResult,
} from '../../utils/shortcutPreset';
import { joinAbsolute } from '../../utils/filePath';
import type { RootId } from '../../../shared/fs/brandedIds';
import { IconButton, OverlayBackdrop, OverlayCard } from '../ui/chrome';
import { Eyebrow } from '../ui/primitives';

const NON_EDITABLE_SHORTCUTS: ReadonlySet<string> = new Set(['overlay-close']);

function importFailureKey(
  result: Extract<ParseShortcutPresetResult, { ok: false }>
): string {
  // Keep parser reasons decoupled from i18n keys so the preset format can
  // evolve without leaking transport-level enum names into UI copy.
  switch (result.reason) {
    case 'invalid-json':
      return 'shortcuts.editor.importInvalidJson';
    case 'unsupported-version':
      return 'shortcuts.editor.importUnsupportedVersion';
    case 'invalid-shape':
    default:
      return 'shortcuts.editor.importInvalidShape';
  }
}

function groupShortcuts(shortcuts: readonly ShortcutDefinition[]) {
  // Preserve catalog order inside each group. The renderer iterates
  // SHORTCUT_GROUPS later, so this map only buckets filtered rows.
  const byGroup = new Map<ShortcutGroupId, ShortcutDefinition[]>();
  for (const shortcut of shortcuts) {
    const bucket = byGroup.get(shortcut.group) ?? [];
    bucket.push(shortcut);
    byGroup.set(shortcut.group, bucket);
  }
  return byGroup;
}

interface KeyboardShortcutsModalProps {
  onClose: () => void;
}

interface ShortcutRowProps {
  shortcut: ShortcutDefinition;
  combos: readonly ShortcutCombo[];
  isOverridden: boolean;
  isRecording: boolean;
  platform: string;
  onStartRecording: () => void;
  onCancelRecording: () => void;
  onReset: () => void;
}

function ShortcutComboPill({
  combo,
  platform,
  comboId,
}: {
  combo: ShortcutCombo;
  platform: string;
  comboId: string;
}) {
  const isMac = platform === 'darwin';

  return (
    <kbd
      data-testid={comboId}
      aria-label={formatShortcutCombo(combo, platform)}
      className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-[0.8rem] border border-border/80 bg-surface-strong/85 px-2.5 py-1 font-sans text-[12px] font-medium text-foreground shadow-sm"
      style={{
        fontVariantLigatures: 'none',
        fontFeatureSettings: '"liga" 0, "calt" 0',
        letterSpacing: '0.01em',
      }}
    >
      {combo.tokens.map((token, index) => (
        <span key={`${comboId}-${token}-${index}`} className="inline-flex items-center">
          {index > 0 && !isMac ? (
            <span aria-hidden="true" className="mr-1 text-muted">
              +
            </span>
          ) : null}
          <span
            data-shortcut-token
            className={
              isMac
                ? 'inline-flex min-w-[0.72rem] justify-center leading-none'
                : 'inline-flex leading-none'
            }
          >
            {formatShortcutToken(token, platform)}
          </span>
        </span>
      ))}
    </kbd>
  );
}

function ShortcutRow({
  shortcut,
  combos,
  isOverridden,
  isRecording,
  platform,
  onStartRecording,
  onCancelRecording,
  onReset,
}: ShortcutRowProps) {
  const { t } = useTranslation();
  const editable = !NON_EDITABLE_SHORTCUTS.has(shortcut.id);
  const rowId = `shortcut-row-${shortcut.id}`;

  return (
    <li
      data-testid={rowId}
      className="flex items-center justify-between gap-4 border-b border-border/60 px-3 py-2 last:border-b-0"
    >
      <div className="grid gap-0.5 text-sm text-foreground">
        <span>{t(shortcut.labelKey)}</span>
        {shortcut.descriptionKey ? (
          <span className="text-xs text-muted">{t(shortcut.descriptionKey)}</span>
        ) : null}
        {isRecording ? (
          <span className="text-xs text-primary" role="status">
            {t('shortcuts.editor.recordingHint')}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="flex items-center gap-1">
          {combos.map((combo, index) => (
            <ShortcutComboPill
              key={`${shortcut.id}-combo-${index}`}
              combo={combo}
              platform={platform}
              comboId={`${shortcut.id}-combo-${index}`}
            />
          ))}
        </div>
        {editable ? (
          // Flat text-link styling (no pill background / static border) so the
          // action cluster doesn't read as part of the kbd pill to its left.
          // The hover border re-adds definition on intent without crowding the
          // resting state.
          <div className="flex items-center gap-2">
            {isRecording ? (
              <button
                type="button"
                onClick={onCancelRecording}
                className="rounded-[0.55rem] border border-transparent px-1.5 py-0.5 text-[11px] text-muted hover:border-border/70 hover:text-foreground"
                aria-label={t('shortcuts.editor.cancelAria', { label: t(shortcut.labelKey) })}
              >
                {t('shortcuts.editor.cancel')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartRecording}
                data-testid={`shortcut-edit-${shortcut.id}`}
                className="rounded-[0.55rem] border border-transparent px-1.5 py-0.5 text-[11px] text-muted hover:border-border/70 hover:text-foreground"
                aria-label={t('shortcuts.editor.editAria', { label: t(shortcut.labelKey) })}
              >
                {t('shortcuts.editor.edit')}
              </button>
            )}
            {isOverridden && !isRecording ? (
              <button
                type="button"
                onClick={onReset}
                data-testid={`shortcut-reset-${shortcut.id}`}
                className="rounded-[0.55rem] border border-transparent px-1.5 py-0.5 text-[11px] text-muted hover:border-border/70 hover:text-foreground"
                aria-label={t('shortcuts.editor.resetSingleAria', { label: t(shortcut.labelKey) })}
              >
                {t('shortcuts.editor.reset')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function KeyboardShortcutsModal({ onClose }: KeyboardShortcutsModalProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const platform = resolveShortcutDisplayPlatform(
    window.lingua?.platform ?? 'unknown',
    window.navigator?.platform
  );

  const overrides = useSettingsStore((state) => state.shortcutOverrides);
  const setShortcutOverride = useSettingsStore((state) => state.setShortcutOverride);
  const clearShortcutOverride = useSettingsStore((state) => state.clearShortcutOverride);
  const resetShortcutOverrides = useSettingsStore((state) => state.resetShortcutOverrides);
  const keymapPreset = useSettingsStore((state) => state.keymapPreset);
  const applyKeymapPreset = useSettingsStore((state) => state.applyKeymapPreset);
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);

  const matching = useMemo(
    () => filterShortcuts(KEYBOARD_SHORTCUTS, query, platform, t),
    [query, platform, t]
  );

  const grouped = useMemo(() => groupShortcuts(matching), [matching]);
  const hasOverrides = Object.keys(overrides).length > 0;

  const cancelRecording = useCallback(() => setRecordingId(null), []);

  useEffect(() => {
    if (!recordingId) return;

    const handler = (event: KeyboardEvent) => {
      // Capture-phase listener wins over app/global shortcuts while a row is
      // recording, so the typed combo edits the binding instead of triggering
      // the existing command.
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setRecordingId(null);
        return;
      }

      const combo = keyboardEventToCombo(event);
      if (!combo) return;
      if (isReservedShortcutCombo(combo)) return;
      event.preventDefault();
      event.stopPropagation();

      // "Reserved" combos are ignored above so browser/system escape hatches
      // still work. Editable combos are stricter: they must include enough
      // modifier signal to avoid accidental single-letter app-wide bindings.
      if (!isEditableShortcutCombo(combo)) {
        pushStatusNotice({
          tone: 'error',
          messageKey: 'shortcuts.editor.invalidCombo',
        });
        return;
      }

      // Conflict detection includes defaults plus user overrides, but excludes
      // the row being edited so re-recording the same combo is a no-op success.
      const conflictId = findComboConflict(KEYBOARD_SHORTCUTS, overrides, combo, recordingId);
      if (conflictId) {
        const other = KEYBOARD_SHORTCUTS.find((entry) => entry.id === conflictId);
        pushStatusNotice({
          tone: 'error',
          messageKey: 'shortcuts.editor.conflict',
          values: {
            combo: formatShortcutCombo(combo, platform),
            label: other ? t(other.labelKey) : conflictId,
          },
        });
        return;
      }

      setShortcutOverride(recordingId, [combo]);
      setRecordingId(null);
      pushStatusNotice({
        tone: 'success',
        messageKey: 'shortcuts.editor.rebound',
        values: { combo: formatShortcutCombo(combo, platform) },
      });
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [recordingId, overrides, platform, pushStatusNotice, setShortcutOverride, t]);

  const handleResetAll = useCallback(() => {
    resetShortcutOverrides();
    pushStatusNotice({ tone: 'success', messageKey: 'shortcuts.editor.resetAllDone' });
  }, [pushStatusNotice, resetShortcutOverrides]);

  const handleExport = useCallback(async () => {
    const saveDialog = window.lingua?.fs?.saveDialog;
    const write = window.lingua?.fs?.write;
    const revokeRoot = window.lingua?.fs?.revokeRoot;
    if (!saveDialog || !write) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'shortcuts.editor.exportBridgeMissing',
      });
      return;
    }
    let mintedRootId: RootId | null = null;
    try {
      const chosen = await saveDialog('lingua-shortcuts.json');
      if (chosen.canceled) return;
      mintedRootId = chosen.rootId;
      // Export only user overrides. Built-in preset ids are derivable from the
      // catalog and would make imported files stale when defaults change.
      const preset = buildShortcutPreset(overrides);
      await write(chosen.rootId, chosen.fileRelativePath, serializeShortcutPreset(preset));
      pushStatusNotice({
        tone: 'success',
        messageKey: 'shortcuts.editor.exported',
        values: {
          path: joinAbsolute(chosen.rootPath, chosen.fileRelativePath),
        },
      });
    } catch (error) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'shortcuts.editor.exportFailed',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // RL-077 — revoke the picker-minted capability after the one-shot
      // write so transient tokens for shortcut exports don't accumulate.
      if (mintedRootId && revokeRoot) {
        await revokeRoot(mintedRootId).catch(() => {});
      }
    }
  }, [overrides, pushStatusNotice]);

  const handleImport = useCallback(async () => {
    const selectFile = window.lingua?.fs?.selectFile;
    const revokeRoot = window.lingua?.fs?.revokeRoot;
    if (!selectFile) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'shortcuts.editor.exportBridgeMissing',
      });
      return;
    }
    let mintedRootId: RootId | null = null;
    try {
      const picked = await selectFile();
      if (picked.canceled) return;
      mintedRootId = picked.rootId;
      const result = parseShortcutPreset(picked.content);

      if (!result.ok) {
        pushStatusNotice({
          tone: 'error',
          messageKey: importFailureKey(result),
          detail: result.message,
        });
        return;
      }

      // Apply import by clearing existing overrides and re-seeding from the
      // preset. Flipping to the `default` keymap-preset id honestly reflects
      // that the user is now running a hand-picked set rather than a built-in.
      resetShortcutOverrides();
      for (const [id, combos] of Object.entries(result.preset.overrides)) {
        setShortcutOverride(id, combos);
      }
      pushStatusNotice({
        tone: 'success',
        messageKey: 'shortcuts.editor.imported',
        values: { count: Object.keys(result.preset.overrides).length },
      });
    } catch (error) {
      pushStatusNotice({
        tone: 'error',
        messageKey: 'shortcuts.editor.importFailed',
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (mintedRootId && revokeRoot) {
        await revokeRoot(mintedRootId).catch(() => {});
      }
    }
  }, [pushStatusNotice, resetShortcutOverrides, setShortcutOverride]);

  return (
    <OverlayBackdrop onClose={onClose}>
      <OverlayCard
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-modal-title"
        data-testid="keyboard-shortcuts-modal"
        className="relative flex h-[min(84vh,820px)] w-[min(96vw,920px)] max-w-none flex-col overflow-hidden"
      >
        <header className="surface-header px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] bg-primary-soft text-primary">
                <Keyboard size={18} />
              </div>
              <div>
                <Eyebrow className="mb-0.5">{t('shortcuts.panelTitle')}</Eyebrow>
                <h2
                  id="keyboard-shortcuts-modal-title"
                  className="font-display text-[22px] font-semibold leading-[1.2] tracking-[-0.02em] text-foreground"
                >
                  {t('shortcuts.title')}
                </h2>
                <p className="mt-1 max-w-2xl text-[12.5px] leading-[1.5] text-muted">
                  {t('shortcuts.description')}
                </p>
              </div>
            </div>
            <IconButton onClick={onClose} tooltip={t('shortcuts.close')} aria-label={t('shortcuts.close')}>
              <X size={16} />
            </IconButton>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[11.5px] text-muted">
              <span>{t('shortcuts.preset.label')}</span>
              <select
                value={keymapPreset}
                onChange={(event) => applyKeymapPreset(event.target.value)}
                data-testid="shortcut-preset-select"
                className="rounded-[0.75rem] border border-border/80 bg-background-elevated/88 px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-primary/50"
              >
                {KEYMAP_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {t(preset.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <div className="relative flex min-w-[14rem] flex-1 items-center">
              <Search
                size={12}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label={t('shortcuts.searchLabel')}
                placeholder={t('shortcuts.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="w-full rounded-[0.85rem] border border-border/80 bg-background-elevated/88 px-8 py-1.5 text-[12px] text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary/50"
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t('shortcuts.searchClear')}
                  className="kbd-shell absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer hover:text-foreground"
                >
                  {t('shortcuts.kbd.escape')}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {matching.length === 0 ? (
            <div className="rounded-[1rem] border border-border/80 bg-background/65 px-4 py-6 text-center">
              <p className="text-[13px] font-medium text-foreground">
                {t('shortcuts.empty.title')}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                {t('shortcuts.empty', { query: query.trim() })}
              </p>
            </div>
          ) : (
            <div className="grid gap-6">
              {SHORTCUT_GROUPS.map((group) => {
                const items = grouped.get(group.id);
                if (!items || items.length === 0) return null;
                return (
                  <section key={group.id}>
                    <Eyebrow>
                      {t(group.labelKey)}
                      {/* RL-088 — was `text-muted/70` at 4.26:1 contrast.
                          Bumped to `text-muted` (full token) so the group
                          count meets the WCAG 2.1 AA threshold (>=4.5:1). */}
                      <span className="ml-2 text-muted normal-case tracking-normal">
                        · {items.length}
                      </span>
                    </Eyebrow>
                    <ul className="grid gap-1 rounded-[1.1rem] border border-border/80 bg-background/65">
                      {items.map((shortcut) => (
                        <ShortcutRow
                          key={shortcut.id}
                          shortcut={shortcut}
                          combos={resolveCombos(shortcut, overrides)}
                          isOverridden={Boolean(overrides[shortcut.id])}
                          isRecording={recordingId === shortcut.id}
                          platform={platform}
                          onStartRecording={() => setRecordingId(shortcut.id)}
                          onCancelRecording={cancelRecording}
                          onReset={() => clearShortcutOverride(shortcut.id)}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-5 py-3">
          <p className="text-xs text-muted">
            {hasOverrides
              ? t('shortcuts.editor.overrideCount', { count: Object.keys(overrides).length })
              : t('shortcuts.editor.noOverrides')}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={!hasOverrides}
              data-testid="shortcut-export"
              className="inline-flex items-center gap-1.5 rounded-[0.75rem] border border-border/80 px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download size={12} />
              {t('shortcuts.editor.export')}
            </button>
            <button
              type="button"
              onClick={() => void handleImport()}
              data-testid="shortcut-import"
              className="inline-flex items-center gap-1.5 rounded-[0.75rem] border border-border/80 px-3 py-1.5 text-xs text-muted hover:text-foreground"
            >
              <Upload size={12} />
              {t('shortcuts.editor.import')}
            </button>
            <button
              type="button"
              onClick={handleResetAll}
              disabled={!hasOverrides}
              data-testid="shortcut-reset-all"
              className="inline-flex items-center gap-1.5 rounded-[0.75rem] border border-border/80 px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={12} />
              {t('shortcuts.editor.resetAll')}
            </button>
          </div>
        </footer>
      </OverlayCard>
    </OverlayBackdrop>
  );
}
