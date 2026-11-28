import type * as monacoTypes from 'monaco-editor';

type Editor = monacoTypes.editor.ICodeEditor;
export type AnswerOwner = 'code' | 'tests';

/** Where one owner's answers sit: beside lines in the column, and rows reserved under lines (height by line). */
export interface AnswerLines {
  readonly beside: ReadonlySet<number>;
  readonly below: ReadonlyMap<number, number>;
}

const NONE: AnswerLines = { beside: new Set(), below: new Map() };
const published = new WeakMap<Editor, Record<AnswerOwner, AnswerLines>>();
const listeners = new WeakMap<Editor, Set<(owner: AnswerOwner) => void>>();

function sameLines(a: AnswerLines, b: AnswerLines): boolean {
  if (a.beside.size !== b.beside.size || a.below.size !== b.below.size) return false;
  for (const line of a.beside) if (!b.beside.has(line)) return false;
  for (const [line, height] of a.below) if (b.below.get(line) !== height) return false;
  return true;
}

/** A blank view zone after `afterLineNumber` that reserves a row for an answer drawn over it. */
export function addSpacerZone(
  accessor: monacoTypes.editor.IViewZoneChangeAccessor,
  afterLineNumber: number,
  heightInPx: number
): { id: string; delegate: monacoTypes.editor.IViewZone } {
  const domNode = document.createElement('div');
  domNode.setAttribute('aria-hidden', 'true');
  const delegate = { afterLineNumber, heightInPx, domNode, suppressMouseDown: true };
  return { id: accessor.addZone(delegate), delegate };
}

/**
 * Code answers and test answers share one editor: each publishes the lines it
 * takes, so the other keeps clear of them. Listeners hear the owner that changed.
 */
export function publishAnswerLines(editor: Editor, owner: AnswerOwner, lines: AnswerLines = NONE): void {
  const current = published.get(editor) ?? { code: NONE, tests: NONE };
  if (sameLines(current[owner], lines)) return;
  published.set(editor, { ...current, [owner]: lines });
  for (const listener of listeners.get(editor) ?? []) listener(owner);
}

export function answerLinesOf(editor: Editor, owner: AnswerOwner): AnswerLines {
  return published.get(editor)?.[owner] ?? NONE;
}

/** Calls `listener` when `owner`'s lines change. */
export function onAnswerLinesChange(editor: Editor, owner: AnswerOwner, listener: () => void): () => void {
  const set = listeners.get(editor) ?? new Set();
  listeners.set(editor, set);
  const filtered = (changed: AnswerOwner) => {
    if (changed === owner) listener();
  };
  set.add(filtered);
  return () => set.delete(filtered);
}
