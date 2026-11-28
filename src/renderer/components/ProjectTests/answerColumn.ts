import { useEffect, useRef, useState } from 'react';
import type * as monacoTypes from 'monaco-editor';
import { answerColumnBand, belowAnswerWidth, lineEnd, lineIndent } from '../Editor/answerColumnGeometry';
import { addSpacerZone, answerLinesOf, onAnswerLinesChange, publishAnswerLines } from '../Editor/answerLines';
import { createLineWidget, type LineWidget } from '../Editor/useLineWidget';

type Editor = monacoTypes.editor.IStandaloneCodeEditor;

const WIDGET_PREFIX = 'lingua.testAnswer';
const LEADER_MARGIN = 26;
const MIN_LEADER = 26;
const MIN_ANSWER = 140;
const NO_KEYS: ReadonlySet<string> = new Set();

interface Placed extends LineWidget {
  key: string;
  node: HTMLElement;
  applied: string;
  measured: boolean;
  /** On a row of its own under the line instead of beside it. */
  below: boolean;
  zone: { id: string; line: number; height: number } | null;
}

/** The answer column in content coordinates: its start, its right edge and its width. */
export function answerColumn(editor: Editor): { start: number; right: number; width: number } {
  const band = answerColumnBand(editor.getLayoutInfo());
  const start = editor.getScrollLeft() + band.start;
  return { start, right: start + band.width, width: band.width };
}

/**
 * One content widget after each line's text whose dotted leader runs to the
 * answer column, so answers line up whatever the line length. Each widget
 * follows its line through edits. In a narrow editor, on a line with no room
 * for the answer, or on a line a code answer takes, the answer moves to a row
 * of its own under the line, as code answers do. Returns the nodes to portal
 * each answer into, by key, and the keys whose line runs into the column or
 * whose answer sits under it.
 */
export function useAnswerColumnWidgets(
  editor: Editor | null,
  monaco: typeof monacoTypes | null,
  rows: readonly { key: string; line: number }[]
): { nodes: ReadonlyMap<string, HTMLElement>; crowded: ReadonlySet<string> } {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const [nodes, setNodes] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const [crowded, setCrowded] = useState<ReadonlySet<string>>(NO_KEYS);
  const signature = rows.map(row => `${row.key}@${row.line}`).join('|');

  useEffect(() => {
    if (!editor || !monaco) {
      setNodes(new Map());
      setCrowded(NO_KEYS);
      return;
    }
    const model = editor.getModel();
    const placed: Placed[] = rows
      .filter(row => model && row.line <= model.getLineCount())
      .map(row => {
        let node = nodesRef.current.get(row.key);
        if (!node) {
          node = document.createElement('div');
          node.className = 'test-answer-widget';
          nodesRef.current.set(row.key, node);
        }
        const entry: Omit<Placed, keyof LineWidget> = { key: row.key, node, applied: '', measured: false, below: false, zone: null };
        const placement = (): 'below' | 'line-end' => (entry.below ? 'below' : 'line-end');
        return Object.assign(entry, createLineWidget(editor, monaco, row.line, node, { id: `${WIDGET_PREFIX}.${row.key}`, placement }));
      });
    for (const key of [...nodesRef.current.keys()]) {
      if (!placed.some(entry => entry.key === key)) nodesRef.current.delete(key);
    }

    // Measure every line first, then write: each measurement can flush Monaco's render.
    const root = editor.getDomNode();
    let columnStart = '';
    // The failing line's tint ends at the column, past its tag (projectTests.css).
    const markColumn = (start: number) => {
      if (`${start}px` === columnStart) return;
      columnStart = `${start}px`;
      root?.style.setProperty('--answer-column-start', columnStart);
    };
    // Set now so a re-run of this effect never leaves a frame without it.
    markColumn(answerColumn(editor).start);
    const layout = () => {
      const info = editor.getLayoutInfo();
      const narrow = answerColumnBand(info).narrow;
      const column = answerColumn(editor);
      markColumn(column.start);
      const code = answerLinesOf(editor, 'code');
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight);
      const scrollLeft = editor.getScrollLeft();
      const lines = placed.map(entry => entry.currentLine());
      const ends = lines.map(line => lineEnd(editor, line));
      const indents = lines.map(line => lineIndent(editor, line));
      const into = new Set<string>();
      placed.forEach((entry, index) => {
        const end = ends[index];
        const line = lines[index]!;
        if (end === null || end === undefined) return;
        entry.measured = true;
        if (end + LEADER_MARGIN + MIN_LEADER > column.start) into.add(entry.key);
        const leader = Math.max(MIN_LEADER, column.start - end - LEADER_MARGIN);
        const answer = Math.min(column.width, column.right - end - LEADER_MARGIN - leader);
        entry.below = narrow || answer < MIN_ANSWER || code.beside.has(line);
        if (entry.below) into.add(entry.key);
        const indent = indents[index] ?? 0;
        const offset = code.below.get(line) ?? 0;
        const belowWidth = belowAnswerWidth(info, Math.max(0, indent - scrollLeft));
        // Monaco keeps a widget's model position until it is laid out again, so a moved line counts as a change.
        const applied = entry.below ? `below:${line}:${indent}:${offset}:${belowWidth}` : `${line}:${leader}:${answer}`;
        if (applied === entry.applied) return;
        entry.applied = applied;
        entry.node.toggleAttribute('data-below', entry.below);
        entry.node.style.setProperty('--test-answer-line', `${lineHeight}px`);
        if (entry.below) {
          // A code answer's row under the same line comes first.
          entry.node.style.marginTop = `${offset}px`;
          entry.node.style.marginLeft = `${indent}px`;
          entry.node.style.width = `${belowWidth}px`;
        } else {
          entry.node.style.marginTop = '';
          entry.node.style.marginLeft = '';
          entry.node.style.setProperty('--test-answer-leader', `${leader}px`);
          entry.node.style.width = `${LEADER_MARGIN + leader + answer}px`;
        }
        editor.layoutContentWidget(entry.widget);
      });
      // Each answer under its line reserves a row as tall as it is.
      const zones = placed.map((entry, index) => ({
        entry,
        line: lines[index]!,
        height: entry.below ? Math.ceil(Math.max(lineHeight, entry.node.getBoundingClientRect().height + 4)) : 0,
      }));
      const moved = zones.filter(({ entry, line, height }) => (entry.zone?.height ?? 0) !== height || (height > 0 && entry.zone?.line !== line));
      if (moved.length > 0) {
        editor.changeViewZones(accessor => {
          for (const { entry, line, height } of moved) {
            if (entry.zone) accessor.removeZone(entry.zone.id);
            entry.zone = null;
            if (height > 0) entry.zone = { id: addSpacerZone(accessor, line, height).id, line, height };
          }
        });
      }
      publishAnswerLines(editor, 'tests', {
        beside: new Set(zones.filter(({ entry }) => entry.measured && !entry.below).map(({ line }) => line)),
        below: new Map(zones.filter(({ entry }) => entry.zone).map(({ entry }) => [entry.zone!.line, entry.zone!.height])),
      });
      setCrowded(current => (current.size === into.size && [...into].every(key => current.has(key)) ? current : into));
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
    const stopListening = onAnswerLinesChange(editor, 'code', schedule);
    setNodes(new Map(placed.map(entry => [entry.key, entry.node])));
    return () => {
      cancelAnimationFrame(frame);
      stopListening();
      for (const listener of listeners) listener.dispose();
      for (const entry of placed) entry.dispose();
      const zones = placed.flatMap(entry => (entry.zone ? [entry.zone.id] : []));
      if (zones.length > 0) editor.changeViewZones(accessor => zones.forEach(id => accessor.removeZone(id)));
      publishAnswerLines(editor, 'tests');
      root?.style.removeProperty('--answer-column-start');
    };
    // `signature` stands for `rows`, which callers rebuild on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, monaco, signature]);

  return { nodes, crowded };
}
