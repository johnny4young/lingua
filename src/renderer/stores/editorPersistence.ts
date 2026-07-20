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
  VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES,
} from './editorTabUtils';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import { isRecipeRunnableLanguage } from '../../shared/lessonRunner';
import { notifyBlockedFamily } from '../utils/blockedPath';

/**
 * internal — disk-persistence helpers extracted verbatim from `editorStore.ts`:
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
 * internal — write the tab to disk through the capability registry.
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
    if (result.canceled) {
      notifyBlockedFamily(result.blockedFamily);
      return null;
    }
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
  // implementation — re-resolve the workflow mode against the
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
  // implementation — same Save-As cleanup for the stdin buffer.
  // `foo.js` → `foo.go` must drop the JS-only buffer so the worker
  // never receives a value it can't honor and the tab stops
  // surfacing the Input panel.
  const stdinBuffer = languageSupportsStdin(language)
    ? tab.stdinBuffer
    : undefined;
  const inputSets = languageSupportsStdin(language) ? tab.inputSets : undefined;
  const activeInputSetId = languageSupportsStdin(language)
    ? tab.activeInputSetId
    : undefined;
  const inputArgs = languageSupportsStdin(language) ? tab.inputArgs : undefined;
  // implementation — Save-As that changes the language drops the
  // Compare toggle. Same-language Save-As (renaming `foo.js` →
  // `bar.js`) keeps the toggle on so the user's workflow isn't
  // interrupted.
  const compareWithSnapshotEnabled =
    tab.language === language && tab.compareWithSnapshotEnabled === true
      ? true
      : undefined;
  // implementation — Save-As that lands on an unsupported language
  // drops the Variables toggle. Same-language Save-As keeps it on.
  const variableInspectorEnabled =
    tab.language === language &&
    tab.variableInspectorEnabled === true &&
    VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES.has(language)
      ? true
      : undefined;
  // implementation — Save-As keeps a recipe binding only when the tab
  // remains on the exact same runnable language. A cross-language save
  // would pair the old assertion pack with incompatible source syntax.
  const recipeBindingId =
    tab.language === language && isRecipeRunnableLanguage(language)
      ? tab.recipeBindingId
      : undefined;
  const {
    autoLogEnabled: _staleAutoLogEnabled,
    stdinBuffer: _staleStdinBuffer,
    inputSets: _staleInputSets,
    activeInputSetId: _staleActiveInputSetId,
    inputArgs: _staleInputArgs,
    // implementation — the per-tab one-shot extended-timeout
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
  void _staleInputSets;
  void _staleActiveInputSetId;
  void _staleInputArgs;
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
    ...(inputSets !== undefined ? { inputSets } : {}),
    ...(activeInputSetId !== undefined ? { activeInputSetId } : {}),
    ...(inputArgs !== undefined ? { inputArgs } : {}),
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
    const wrote = await window.lingua.fs.write(
      asRootId(rootId),
      asRelativePath(relativePath),
      content
    );
    if (!wrote) {
      if (mintedRootId)
        await window.lingua.fs.revokeRoot(asRootId(mintedRootId)).catch(() => {});
      return null;
    }
  } catch (error) {
    if (mintedRootId)
      await window.lingua.fs.revokeRoot(asRootId(mintedRootId)).catch(() => {});
    throw error;
  }

  return {
    ...nextTab,
    content,
    isDirty: false,
  };
}
