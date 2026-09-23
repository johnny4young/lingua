import type * as monaco from 'monaco-editor';
import type { FileTab } from '../types/editor';
import { useUIStore } from '../stores/uiStore';
import { writeToClipboard } from './clipboard';

export type SelectionTransferFormat = 'reference' | 'context';
type SelectionTab = Pick<FileTab, 'name' | 'language' | 'relativePath'>;
type SelectionEditor = Pick<
  monaco.editor.IStandaloneCodeEditor,
  'getSelection' | 'getModel'
>;

/** No implicit whole-buffer fallback: an empty Monaco selection disables both actions. */
export function hasExplicitSelection(editor: SelectionEditor | null): boolean {
  const selection = editor?.getSelection();
  return Boolean(selection && !selection.isEmpty() && editor?.getModel());
}

function safeReferencePath(tab: SelectionTab): string {
  const relative = tab.relativePath?.replace(/\\/g, '/');
  if (
    relative &&
    !relative.startsWith('/') &&
    !/^[A-Za-z]:/u.test(relative) &&
    !relative.split('/').some(part => !part || part === '.' || part === '..') &&
    stripControlCharacters(relative) === relative
  ) {
    return relative;
  }
  const basename = stripControlCharacters(tab.name.replace(/\\/g, '/').split('/').pop() ?? '')
    .trim();
  return basename && basename !== '.' && basename !== '..' ? basename : 'Untitled';
}

function stripControlCharacters(value: string): string {
  return Array.from(value).filter(char => {
    const code = char.charCodeAt(0);
    return code > 31 && code !== 127;
  }).join('');
}

function codeFenceFor(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) {
    longest = Math.max(longest, match[0].length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

const FENCE_LANGUAGE: Partial<Record<FileTab['language'], string>> = {
  javascript: 'js', typescript: 'ts', python: 'py', ruby: 'ruby',
  go: 'go', rust: 'rust', lua: 'lua',
};

/** Read only Monaco's selected range; never read or derive hidden buffer content. */
export function buildSelectionTransfer(
  editor: SelectionEditor | null,
  tab: SelectionTab,
  format: SelectionTransferFormat
): string | null {
  if (!editor) return null;
  const selection = editor.getSelection();
  const model = editor.getModel();
  if (!selection || selection.isEmpty() || !model) return null;
  const selected = model.getValueInRange(selection);
  if (!selected) return null;

  const endLine = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber
    ? selection.endLineNumber - 1
    : selection.endLineNumber;
  const lines = endLine > selection.startLineNumber
    ? `${selection.startLineNumber}-${endLine}`
    : `${selection.startLineNumber}`;
  const reference = `${safeReferencePath(tab)}:${lines}`;
  if (format === 'reference') return reference;

  const fence = codeFenceFor(selected);
  const language = FENCE_LANGUAGE[tab.language] ?? '';
  return `${reference}\n${fence}${language}\n${selected}${selected.endsWith('\n') ? '' : '\n'}${fence}`;
}

export async function copyEditorSelection(
  editor: SelectionEditor | null,
  tab: SelectionTab,
  format: SelectionTransferFormat
): Promise<'copied' | 'no-selection' | 'clipboard-unavailable'> {
  const text = buildSelectionTransfer(editor, tab, format);
  if (text === null) return 'no-selection';
  return (await writeToClipboard(text)) ? 'copied' : 'clipboard-unavailable';
}

export async function copyEditorSelectionWithNotice(
  editor: SelectionEditor | null,
  tab: SelectionTab,
  format: SelectionTransferFormat
): Promise<void> {
  const result = await copyEditorSelection(editor, tab, format);
  if (result === 'no-selection') return;
  useUIStore.getState().pushStatusNotice({
    tone: result === 'copied' ? 'success' : 'warning',
    messageKey: result === 'copied'
      ? `editor.selectionTransfer.${format}.copied`
      : 'editor.selectionTransfer.clipboardUnavailable',
  });
}

/** Register the same Free, selection-only actions on the main and modified diff editors. */
export function registerSelectionTransferActions(
  editor: monaco.editor.IStandaloneCodeEditor,
  getTab: () => SelectionTab | null,
  labels: Record<SelectionTransferFormat, string>
): () => void {
  const actions = (['reference', 'context'] as const).map((format, index) => editor.addAction({
    id: `lingua.selection.copy-${format}`,
    label: labels[format],
    precondition: 'editorHasSelection',
    contextMenuGroupId: '9_copy',
    contextMenuOrder: index + 1,
    run: (source) => {
      const tab = getTab();
      if (tab) void copyEditorSelectionWithNotice(source, tab, format);
    },
  }));
  return () => { for (const action of actions) action.dispose(); };
}
