import type { Monaco, OnMount } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import {
  detectPasteIntent,
  type PasteIntentKind,
} from '../clipboard/pasteHandlers';
import { applyPasteIntent } from '../clipboard/applyPasteIntent';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { useTelemetry } from './useTelemetry';

type EditorInstance = Parameters<OnMount>[0];

/**
 * One-shot module flag: when set, the next `onDidPaste` skips smart-paste
 * detection and leaves the paste literal. Module-scoped (not a hook ref) so
 * both the editor's Cmd+Shift+V keybinding AND the command-palette "Paste as
 * plain text" action (RL-110 fold D) can request a bypass through the same
 * `requestPlainPaste` entry point. Lingua mounts a single Monaco editor, so a
 * shared flag is unambiguous.
 */
let skipNextPaste = false;
let skipNextPasteResetTimer: number | null = null;

function clearPlainPasteBypass(): void {
  skipNextPaste = false;
  if (skipNextPasteResetTimer != null) {
    window.clearTimeout(skipNextPasteResetTimer);
    skipNextPasteResetTimer = null;
  }
}

function armPlainPasteBypass(): void {
  clearPlainPasteBypass();
  skipNextPaste = true;
  // If Monaco/browser clipboard access is denied and no onDidPaste event ever
  // arrives, do not let the bypass leak into the user's next ordinary paste.
  skipNextPasteResetTimer = window.setTimeout(() => {
    clearPlainPasteBypass();
  }, 1000);
}

/**
 * RL-110 fold D — request a detection-bypassing paste on the given editor: set
 * the one-shot skip flag, then trigger Monaco's standard clipboard paste so the
 * resulting `onDidPaste` is left literal. Shared by the Cmd+Shift+V keybinding
 * and the command-palette action.
 */
export function requestPlainPaste(editor: EditorInstance): void {
  armPlainPasteBypass();
  editor.trigger('lingua-smart-paste', 'editor.action.clipboardPasteAction', {});
}

/** i18n key for the toast message, per detected handler. */
const MESSAGE_KEY: Record<PasteIntentKind, string> = {
  'share-link': 'paste.intent.shareLink.message',
  capsule: 'paste.intent.capsule.message',
  curl: 'paste.intent.curl.message',
  'stack-trace': 'paste.intent.stackTrace.message',
  'large-json': 'paste.intent.largeJson.message',
};

/** i18n key for the primary "Import as X" action, per detected handler. */
const IMPORT_LABEL_KEY: Record<PasteIntentKind, string> = {
  'share-link': 'paste.intent.action.importShareLink',
  capsule: 'paste.intent.action.importCapsule',
  curl: 'paste.intent.action.importCurl',
  'stack-trace': 'paste.intent.action.openStackFrame',
  'large-json': 'paste.intent.action.importLargeJson',
};

/**
 * RL-110 — smart paste detection. Registers a second `onDidPaste` listener
 * (Monaco allows many) that reads the exact pasted text from the event range,
 * asks the pure detectors what it is, and — when the master toggle is on and
 * the paste was not a Cmd+Shift+V plain paste — surfaces a non-blocking status
 * notice offering "Import as X" vs "Keep as text". The import action delegates
 * to `applyPasteIntent`, which routes to the existing importer and strips the
 * literal paste from the buffer.
 *
 * Telemetry: `editor.smart_paste_shown` on toast appearance, then exactly one
 * `editor.smart_paste_applied { accepted }` per toast (true on import, false on
 * keep-as-text / auto-dismiss / manual dismiss). No pasted content is sent.
 *
 * Cmd+Shift+V is bound to a detection-bypassing paste: it sets a one-shot skip
 * flag, then triggers Monaco's standard paste so the next `onDidPaste` is left
 * literal.
 */
export function useSmartPaste(editor: EditorInstance | null, monaco: Monaco | null): void {
  const { track } = useTelemetry();
  // `editor.addCommand` returns no disposable and binds for the editor's
  // lifetime, so guard it against re-registration. Without this, React
  // StrictMode's dev double-invoke (setup → cleanup → setup) would bind the
  // Cmd+Shift+V keybinding twice and fire two plain pastes per press. The ref
  // persists across the simulated remount on the same fiber; a genuine new
  // editor mount is a fresh component instance with a fresh ref.
  const commandBoundRef = useRef(false);

  useEffect(() => {
    if (!editor || !monaco) return undefined;

    const pasteDisposable = editor.onDidPaste((event) => {
      if (skipNextPaste) {
        clearPlainPasteBypass();
        return;
      }
      if (!useSettingsStore.getState().smartPasteDetectionEnabled) return;
      const model = editor.getModel();
      if (!model) return;
      const pastedText = model.getValueInRange(event.range);
      const intent = detectPasteIntent(pastedText);
      if (!intent) return;
      const handler = intent.kind;
      track('editor.smart_paste_shown', { handler });
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        priority: 'low',
        messageKey: MESSAGE_KEY[handler],
        actions: [
          {
            labelKey: IMPORT_LABEL_KEY[handler],
            onClick: () => {
              track('editor.smart_paste_applied', { handler, accepted: true });
              void applyPasteIntent(intent, { model, pastedRange: event.range, pastedText });
              useUIStore.getState().dismissStatusNotice('cta');
            },
          },
          {
            labelKey: 'paste.intent.action.pasteAsText',
            onClick: () => {
              track('editor.smart_paste_applied', { handler, accepted: false });
              useUIStore.getState().dismissStatusNotice('cta');
            },
          },
        ],
        // Auto-dismiss (timeout) and manual (X) count as "not imported". The
        // action handlers dismiss with 'cta', which this skips, so telemetry
        // fires exactly once per toast.
        onDismiss: (mode) => {
          if (mode === 'auto' || mode === 'manual') {
            track('editor.smart_paste_applied', { handler, accepted: false });
          }
        },
      });
    });

    // Cmd+Shift+V — paste as plain text, bypassing detection for one paste.
    // Shares `requestPlainPaste` with the command-palette action (fold D).
    if (!commandBoundRef.current) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV, () => {
        requestPlainPaste(editor);
      });
      commandBoundRef.current = true;
    }

    return () => {
      pasteDisposable.dispose();
    };
  }, [editor, monaco, track]);
}
