/**
 * A tool's output back into the editor: the inserted lines stay tinted, with
 * a note naming the tool under them, until the next edit.
 */
import type * as monacoTypes from 'monaco-editor';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import type { DeveloperUtilityId } from '../../data/developerUtilityCatalog';
import { currentShortcutDisplayPlatform, formatShortcutCombo } from '../../data/keyboardShortcuts';
import { getLastCodeCursor, type CodeCursor } from '../../runtime/editorAccess';
import { requestEditorInsert, useEditorInsertStore, type EditorInsert } from '../../runtime/editorInsert';
import { useEditorStore } from '../../stores/editorStore';
import type { FileTab } from '../../types/editor';
import { Kbd } from '../ui/chrome';
import { UTILITY_ICON } from './utilityIcons';
import '../../i18n/clipboardChainsCatalog';

type Editor = monacoTypes.editor.IStandaloneCodeEditor;

export interface InsertTarget extends CodeCursor {
  readonly name: string;
}

export interface InsertSource {
  readonly utilityId: DeveloperUtilityId;
  readonly tool: string;
}

// Monaco also breaks lines on a lone CR, so the tab's text is counted the same way.
const LINE_BREAK = /\r\n|\r|\n/gu;

function lineCount(content: string): number {
  return (content.match(LINE_BREAK)?.length ?? 0) + 1;
}

/** Length of line `line` (1-based) without its line break. */
function lineLength(content: string, line: number): number {
  return content.split(LINE_BREAK, line)[line - 1]?.length ?? 0;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Where an insert lands: the code tab and cursor the editor showed last,
 * clamped to the tab's text, else the end of the last code tab in the strip.
 */
export function resolveInsertTarget(tabs: readonly FileTab[], cursor: CodeCursor | null = getLastCodeCursor()): InsertTarget | null {
  const codeTabs = tabs.filter((tab) => !tab.kind);
  const remembered = cursor ? codeTabs.find((tab) => tab.id === cursor.tabId) : undefined;
  const tab = remembered ?? codeTabs.at(-1);
  if (!tab) return null;
  const at = remembered ? cursor : null;
  const count = lineCount(tab.content);
  const line = at ? clamp(at.line, 1, count) : count;
  const length = lineLength(tab.content, line);
  const column = at ? clamp(at.column, 1, length + 1) : length + 1;
  return { tabId: tab.id, name: tab.name, line, column };
}

function InsertedNote({ utilityId, tool }: InsertSource) {
  const Icon = UTILITY_ICON[utilityId];
  return (
    <div role="status" className="inserted-note-body">
      <Icon size={12} strokeWidth={1.6} aria-hidden="true" />
      <span>{i18next.t('utilityHandoff.inserted', { tool })}</span>
      <span aria-hidden="true" className="inserted-note-dot">
        ·
      </span>
      <Kbd>{formatShortcutCombo({ tokens: ['Mod', 'z'] }, currentShortcutDisplayPlatform())}</Kbd>
      <span>{i18next.t('utilityHandoff.undo')}</span>
    </div>
  );
}

let clearMark: (() => void) | null = null;

/** Tint lines `from`–`to` and note the tool under them until the next edit, model swap or newer insert. */
function markInserted(editor: Editor, monaco: typeof monacoTypes, from: number, to: number, source: InsertSource): void {
  clearMark?.();
  const tint = editor.createDecorationsCollection([
    {
      range: new monaco.Range(from, 1, to, 1),
      options: { isWholeLine: true, className: 'lingua-inserted-line', marginClassName: 'lingua-inserted-line' },
    },
  ]);
  const node = document.createElement('div');
  node.className = 'lingua-inserted-note';
  node.dataset.testid = 'utility-inserted-note';
  const root = createRoot(node);
  root.render(<InsertedNote {...source} />);
  let zoneId = '';
  editor.changeViewZones((accessor) => {
    zoneId = accessor.addZone({
      afterLineNumber: to,
      heightInPx: editor.getOption(monaco.editor.EditorOption.lineHeight) + 8,
      domNode: node,
      suppressMouseDown: true,
    });
  });
  let listeners: monacoTypes.IDisposable[] = [];
  const teardown = () => {
    clearMark = null;
    for (const listener of listeners) listener.dispose();
    // Monaco can fire mid-render, where a React root must not unmount synchronously.
    window.setTimeout(() => root.unmount(), 0);
  };
  const clear = () => {
    teardown();
    tint.clear();
    editor.changeViewZones((accessor) => accessor.removeZone(zoneId));
  };
  // Before the swap: once another model is attached, the tint could no longer be removed from this one.
  listeners = [editor.onDidChangeModelContent(clear), editor.onWillChangeModel(clear), editor.onDidDispose(teardown)];
  clearMark = clear;
}

/** Open the target tab; the code editor inserts `text` at its cursor as one undo step. */
export function insertIntoCodeTab(target: InsertTarget, text: string, source: InsertSource): void {
  const request: EditorInsert = {
    tabId: target.tabId,
    line: target.line,
    column: target.column,
    text,
    onInserted: (editor, monaco, from, to) => markInserted(editor, monaco, from, to, source),
  };
  requestEditorInsert(request);
  useEditorStore.getState().setActiveTab(target.tabId);
  // Leaving the tab before the editor mounts drops the insert, so it never lands on a later visit.
  const unsubscribe = useEditorStore.subscribe((state) => {
    const pending = useEditorInsertStore.getState().request;
    if (pending === request && state.activeTabId !== target.tabId) useEditorInsertStore.setState({ request: null });
    if (pending !== request || state.activeTabId !== target.tabId) unsubscribe();
  });
}
