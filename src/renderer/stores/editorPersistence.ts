import type { FileTab } from '../types';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { joinAbsolute } from '../utils/filePath';
import {
  formatSource,
  isFormatterSupported,
  type FormatterFailure,
} from '../utils/formatters';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import { runtimeModeForRestoredTab, workflowModeForRestoredTab } from './editorModeHelpers';
import {
  languageSupportsAutoLog,
  languageSupportsStdin,
  RECIPE_BINDING_SUPPORTED_LANGUAGES,
  VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES,
} from './editorTabUtils';

/**
 * RL-128 — disk-persistence helpers extracted verbatim from `editorStore.ts`:
 * format-on-save resolution and `persistTab` (the Save / Save-As write path
 * with its capability-revoke ladder). Depends on `editorTabUtils` +
 * `editorModeHelpers` and the settings/UI stores, never on `editorStore`, so
 * `saveTabById` (in `editorSaveActions`) imports this rather than inlining it.
 *
 * The `void _drop` statements below mirror the store's rest-destructure idiom:
 * they make the field omission explicit to TypeScript/ESLint.
 */

const FORMATTER_FAILURE_NOTICE: Record<FormatterFailure, { tone: 'error' | 'info'; messageKey: string } | null> = {
  unsupported: null,
  'parse-error': { tone: 'error', messageKey: 'editor.formatOnSave.parseError' },
  'binary-missing': { tone: 'error', messageKey: 'editor.formatOnSave.binaryMissing' },
  'web-unavailable': { tone: 'info', messageKey: 'editor.formatOnSave.webUnavailable' },
  unknown: { tone: 'error', messageKey: 'editor.formatOnSave.unknownError' },
};

/**
 * Try to format `content` when `formatOnSave` is enabled and the tab's
 * language has a formatter strategy. Emits a dismissable status notice on
 * failure but never throws — we always fall back to saving the original
 * content so format issues never block persistence.
 */
async function resolveFormattedContent(
  tab: FileTab
): Promise<string> {
  const { formatOnSave } = useSettingsStore.getState();
  if (!formatOnSave) return tab.content;
  if (!isFormatterSupported(tab.language)) return tab.content;

  const result = await formatSource(tab.language, tab.content);
  if (result.ok) return result.formatted;

  const notice = FORMATTER_FAILURE_NOTICE[result.failure];
  if (notice) {
    useUIStore.getState().pushStatusNotice({
      tone: notice.tone,
      messageKey: notice.messageKey,
      values: { name: tab.name },
      detail: result.message,
    });
  }
  return tab.content;
}

export function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath;
}

/**
 * RL-077 — write the tab to disk through the capability registry.
 *
 *   - If the tab already carries a `{ rootId, relativePath }` pair
 *     and we are not in Save-As, write through that capability.
 *   - Otherwise prompt the save dialog: main mints a fresh capability
 *     bound to the parent directory of the chosen target, and we
 *     write the file under that capability's relative path.
 *
 * `tab.filePath` is kept up to date as a display-only string for
 * tooltips and session-store persistence, but is never sent to an IPC
 * handler — every actual filesystem touch goes through `rootId`.
 */
export async function persistTab(
  tab: FileTab,
  forceSaveAs = false
): Promise<
  | (FileTab & { filePath: string; rootId: string; relativePath: string })
  | null
> {
  let rootId: string | undefined = tab.rootId;
  let relativePath: string | undefined = tab.relativePath;
  let absolutePath: string | undefined = tab.filePath;
  let mintedRootId: string | null = null;

  const needsPicker = forceSaveAs || !rootId || !relativePath;
  if (needsPicker) {
    const result = await window.lingua.fs.saveDialog(tab.name);
    if (result.canceled) return null;
    rootId = result.rootId;
    mintedRootId = result.rootId;
    relativePath = result.fileRelativePath;
    absolutePath = joinAbsolute(result.rootPath, result.fileRelativePath);
  }

  if (!rootId || !relativePath || !absolutePath) {
    return null;
  }

  const name = basename(absolutePath);
  const language = resolveFileLanguageOrPlaintext(name);
  const runtimeMode = runtimeModeForRestoredTab(language, tab.runtimeMode);
  // RL-020 Slice 2 — re-resolve the workflow mode against the
  // possibly-changed language (Save-As may flip `.js` → `.py`). The
  // coerce helper snaps an unsupported choice back to the language
  // default; this branch is the silent equivalent of the explicit
  // language-change auto-correction in `renameTab`.
  const workflowMode = workflowModeForRestoredTab(language, tab.workflowMode);
  // Save As can change the tab's language just like renameTab. Keep
  // JS / TS overrides, but drop stale auto-log flags for every other
  // language so Python / Go tabs never carry an ignored JS-only bit.
  const autoLogEnabled = languageSupportsAutoLog(language)
    ? tab.autoLogEnabled
    : undefined;
  // RL-020 Slice 6 — same Save-As cleanup for the stdin buffer.
  // `foo.js` → `foo.go` must drop the JS-only buffer so the worker
  // never receives a value it can't honor and the tab stops
  // surfacing the Input panel.
  const stdinBuffer = languageSupportsStdin(language)
    ? tab.stdinBuffer
    : undefined;
  // RL-020 Slice 8 — Save-As that changes the language drops the
  // Compare toggle. Same-language Save-As (renaming `foo.js` →
  // `bar.js`) keeps the toggle on so the user's workflow isn't
  // interrupted.
  const compareWithSnapshotEnabled =
    tab.language === language && tab.compareWithSnapshotEnabled === true
      ? true
      : undefined;
  // RL-020 Slice 9 — Save-As that lands on an unsupported language
  // drops the Variables toggle. Same-language Save-As keeps it on.
  const variableInspectorEnabled =
    tab.language === language &&
    tab.variableInspectorEnabled === true &&
    VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES.has(language)
      ? true
      : undefined;
  // RL-039 Slice B — Save-As can change a recipe tab from `.js` to a
  // non-runnable language. Keep the binding only when the saved tab
  // remains on the same supported language; otherwise the persisted
  // session copy would resurrect a stale Recipe panel after reload.
  const recipeBindingId =
    tab.language === language && RECIPE_BINDING_SUPPORTED_LANGUAGES.has(language)
      ? tab.recipeBindingId
      : undefined;
  const {
    autoLogEnabled: _staleAutoLogEnabled,
    stdinBuffer: _staleStdinBuffer,
    // RL-020 Slice 7 — the per-tab one-shot extended-timeout
    // override is always scoped to the code the user was looking
    // at when they armed it. A Save-As that retitles or changes
    // language drops the override.
    nextRunTimeoutOverrideMs: _staleNextRunTimeoutOverride,
    compareWithSnapshotEnabled: _staleCompareEnabled,
    variableInspectorEnabled: _staleInspectorEnabled,
    recipeBindingId: _staleRecipeBindingId,
    ...tabWithoutDropped
  } = tab;
  void _staleAutoLogEnabled;
  void _staleStdinBuffer;
  void _staleNextRunTimeoutOverride;
  void _staleCompareEnabled;
  void _staleInspectorEnabled;
  void _staleRecipeBindingId;
  const nextTab: FileTab & { filePath: string; rootId: string; relativePath: string } = {
    ...tabWithoutDropped,
    filePath: absolutePath,
    rootId,
    relativePath,
    name,
    language,
    runtimeMode,
    workflowMode,
    ...(autoLogEnabled !== undefined ? { autoLogEnabled } : {}),
    ...(stdinBuffer !== undefined ? { stdinBuffer } : {}),
    ...(compareWithSnapshotEnabled !== undefined
      ? { compareWithSnapshotEnabled }
      : {}),
    ...(variableInspectorEnabled !== undefined
      ? { variableInspectorEnabled }
      : {}),
    ...(recipeBindingId !== undefined ? { recipeBindingId } : {}),
  };
  let content: string;
  try {
    content = await resolveFormattedContent(nextTab);
    const wrote = await window.lingua.fs.write(rootId, relativePath, content);
    if (!wrote) {
      if (mintedRootId) await window.lingua.fs.revokeRoot(mintedRootId).catch(() => {});
      return null;
    }
  } catch (error) {
    if (mintedRootId) await window.lingua.fs.revokeRoot(mintedRootId).catch(() => {});
    throw error;
  }

  return {
    ...nextTab,
    content,
    isDirty: false,
  };
}
