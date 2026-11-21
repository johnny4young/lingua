import { useEffect, useRef, useState } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { createLineWidget } from '../Editor/useLineWidget';

type Editor = monacoTypes.editor.IStandaloneCodeEditor;

const WIDGET_PREFIX = 'lingua.testAnswer';
const RIGHT_PAD = 22;
const LEADER_MARGIN = 26;
const MIN_LEADER = 26;
const MIN_ANSWER = 140;

/** The answer column in content coordinates: its start, its right edge and its width. */
export function answerColumn(editor: Editor): { start: number; right: number; width: number } {
  const layout = editor.getLayoutInfo();
  const width = Math.round(Math.min(600, Math.max(300, layout.contentWidth * 0.4)));
  const right = editor.getScrollLeft() + layout.contentWidth - RIGHT_PAD;
  return { start: right - width, right, width };
}

/** Where a line's text ends in content coordinates, or null while Monaco has not rendered it. */
export function lineEnd(editor: Editor, line: number): number | null {
  const model = editor.getModel();
  if (!model || line < 1 || line > model.getLineCount()) return null;
  const offset = editor.getOffsetForColumn(line, model.getLineMaxColumn(line));
  return offset >= 0 ? offset : null;
}

/**
 * One content widget after each line's text whose dotted leader runs to the
 * answer column, so answers line up whatever the line length. Each widget
 * follows its line through edits and hides when the line leaves no room.
 * Returns the nodes to portal each answer into, by key.
 */
export function useAnswerColumnWidgets(
  editor: Editor | null,
  monaco: typeof monacoTypes | null,
  rows: readonly { key: string; line: number }[]
): ReadonlyMap<string, HTMLElement> {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const [nodes, setNodes] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const signature = rows.map(row => `${row.key}@${row.line}`).join('|');

  useEffect(() => {
    if (!editor || !monaco) {
      setNodes(new Map());
      return;
    }
    const model = editor.getModel();
    const placed = rows
      .filter(row => model && row.line <= model.getLineCount())
      .map(row => {
        let node = nodesRef.current.get(row.key);
        if (!node) {
          node = document.createElement('div');
          node.className = 'test-answer-widget';
          nodesRef.current.set(row.key, node);
        }
        const widget = createLineWidget(editor, monaco, row.line, node, { id: `${WIDGET_PREFIX}.${row.key}`, placement: 'line-end' });
        return { key: row.key, node, ...widget, applied: '', measured: false };
      });
    for (const key of [...nodesRef.current.keys()]) {
      if (!placed.some(entry => entry.key === key)) nodesRef.current.delete(key);
    }

    // Measure every line first, then write: each measurement can flush Monaco's render.
    const layout = () => {
      const column = answerColumn(editor);
      const ends = placed.map(entry => lineEnd(editor, entry.currentLine()));
      placed.forEach((entry, index) => {
        const end = ends[index];
        if (end === null || end === undefined) return;
        entry.measured = true;
        const leader = Math.max(MIN_LEADER, column.start - end - LEADER_MARGIN);
        const answer = Math.min(column.width, column.right - end - LEADER_MARGIN - leader);
        const applied = answer < MIN_ANSWER ? 'hidden' : `${leader}:${answer}`;
        if (applied === entry.applied) return;
        entry.applied = applied;
        entry.node.style.display = applied === 'hidden' ? 'none' : '';
        if (applied !== 'hidden') {
          entry.node.style.setProperty('--test-answer-leader', `${leader}px`);
          entry.node.style.width = `${LEADER_MARGIN + leader + answer}px`;
        }
        editor.layoutContentWidget(entry.widget);
      });
    };
    let frame = 0;
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(() => {
        frame = 0;
        layout();
      });
    };
    schedule();
    const listeners = [
      editor.onDidLayoutChange(schedule),
      editor.onDidChangeModelContent(schedule),
      editor.onDidChangeConfiguration(schedule),
      // Vertical scrolling moves widgets by itself; only a sideways scroll or a line seen for the first time needs layout.
      editor.onDidScrollChange(event => {
        if (event.scrollLeftChanged || placed.some(entry => !entry.measured)) schedule();
      }),
    ];
    setNodes(new Map(placed.map(entry => [entry.key, entry.node])));
    return () => {
      cancelAnimationFrame(frame);
      for (const listener of listeners) listener.dispose();
      for (const entry of placed) entry.dispose();
    };
    // `signature` stands for `rows`, which callers rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, monaco, signature]);

  return nodes;
}
