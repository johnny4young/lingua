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
import { requestEditorInsert } from '../../runtime/editorInsert';
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

function lineCount(content: string): number {
  let count = 1;
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) count += 1;
  return count;
}

/** Length of line `line` (1-based) without its line break. */
function lineLength(content: string, line: number): number {
  let start = 0;
  for (let current = 1; current < line; current += 1) start = content.indexOf('\n', start) + 1;
  const end = content.indexOf('\n', start);
  const stop = end === -1 ? content.length : end;
  return stop - start - (stop > start && content[stop - 1] === '\r' ? 1 : 0);
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
  listeners = [editor.onDidChangeModelContent(clear), editor.onDidChangeModel(clear), editor.onDidDispose(teardown)];
  clearMark = clear;
}

/** Open the target tab; the code editor inserts `text` at its cursor as one undo step. */
export function insertIntoCodeTab(target: InsertTarget, text: string, source: InsertSource): void {
  requestEditorInsert({
    tabId: target.tabId,
    line: target.line,
    column: target.column,
    text,
    onInserted: (editor, monaco, from, to) => markInserted(editor, monaco, from, to, source),
  });
  useEditorStore.getState().setActiveTab(target.tabId);
}
