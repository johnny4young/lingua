import type { NotebookCellLanguage, NotebookCellV1 } from '../../shared/notebook';
import { hasNotebookExecutionEvidence } from '../stores/notebookReactivity';
import type { NotebookCellRunStatus } from '../stores/notebookStorePrimitives';

/** What a notebook cell used from the cells above it and what it made for the cells below. */
export interface NotebookVarFlow {
  readonly uses: ReadonlyArray<string>;
  readonly produces: ReadonlyArray<string>;
}

const IDENTIFIER_TOKEN_RE = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const MAX_USES_CHIP_KEYS = 8;

/**
 * Names in `source` that `priorNames` already held: a token match, so an
 * attribute (`obj.foo`) reports `obj`. Python strings and comments are skipped.
 */
export function deriveUsesKeys(
  source: string,
  priorNames: ReadonlyArray<string>,
  language?: NotebookCellLanguage
): string[] {
  if (priorNames.length === 0 || source.length === 0) return [];
  // SQL folds unquoted names and may qualify them with a schema.
  const sql = language === 'sql';
  const keyOf = (name: string) => (sql ? (name.split('.').pop() ?? name).toLowerCase() : name);
  const prior = new Map(priorNames.map((name) => [keyOf(name), name]));
  const text = language === 'python' ? pythonStatements(source).map((statement) => statement.code).join('\n') : source;
  const referenced = new Set<string>();
  for (const match of text.matchAll(IDENTIFIER_TOKEN_RE)) {
    const name = prior.get(keyOf(match[0]));
    if (name !== undefined) referenced.add(name);
    if (referenced.size >= MAX_USES_CHIP_KEYS) break;
  }
  return [...referenced];
}

interface PythonStatement {
  /** The statement with string bodies blanked (f-strings keep theirs) and comments dropped. */
  readonly code: string;
  /** Starts at column 0: a module-level statement. */
  readonly topLevel: boolean;
}

const OPENERS = '([{';
const CLOSERS = ')]}';
const INLINE_BLOCK = /^(?:if|elif|else|for|while|with|try|except|finally|def|class|async)\b/;

/** Python source as logical statements: brackets, strings, continuations and `;` resolved. */
function pythonStatements(source: string): PythonStatement[] {
  const statements: PythonStatement[] = [];
  let code = '';
  let depth = 0;
  let topLevel = true;
  let atLineStart = true;
  const flush = () => {
    if (code.trim()) statements.push({ code, topLevel });
    code = '';
  };
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]!;
    if (atLineStart) {
      topLevel = ch !== ' ' && ch !== '\t';
      atLineStart = false;
    }
    if (ch === '#') {
      while (index + 1 < source.length && source[index + 1] !== '\n') index += 1;
      continue;
    }
    if (ch === '\\' && source[index + 1] === '\n') {
      index += 1;
      code += ' ';
      continue;
    }
    if (ch === '"' || ch === "'") {
      const prefix = /[A-Za-z]{0,2}$/.exec(code)?.[0] ?? '';
      const keep = /f/i.test(prefix);
      const triple = source.startsWith(ch.repeat(3), index);
      const quote = triple ? ch.repeat(3) : ch;
      let end = index + quote.length;
      while (end < source.length && !source.startsWith(quote, end)) {
        if (source[end] === '\\') end += 1;
        else if (!triple && source[end] === '\n') break;
        end += 1;
      }
      const body = source.slice(index + quote.length, end);
      code += `${quote}${keep ? body.replace(/\n/g, ' ') : ''}${quote}`;
      // An unclosed string ends at its line, which still ends the statement.
      index = source.startsWith(quote, end) ? end + quote.length - 1 : end - 1;
      continue;
    }
    if (OPENERS.includes(ch)) depth += 1;
    else if (CLOSERS.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === '\n') {
      if (depth === 0) {
        flush();
        atLineStart = true;
      } else code += ' ';
      continue;
    }
    if (ch === ';' && depth === 0) {
      // `if x: a = 1; b = 2` keeps `b` in the block's body.
      const wasTop: boolean = topLevel && !INLINE_BLOCK.test(code.trim());
      flush();
      topLevel = wasTop;
      continue;
    }
    code += ch;
  }
  flush();
  return statements;
}

/** `text` split on `separator` outside brackets. */
function splitTop(text: string, separator: (text: string, index: number) => boolean): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index]!;
    if (OPENERS.includes(ch)) depth += 1;
    else if (CLOSERS.includes(ch)) depth -= 1;
    else if (depth === 0 && separator(text, index)) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const COMPARISON_BEFORE = '=!<>:+-*/%@&|^';
const isAssign = (text: string, index: number) =>
  text[index] === '=' && text[index + 1] !== '=' && !COMPARISON_BEFORE.includes(text[index - 1] ?? '');
const isComma = (text: string, index: number) => text[index] === ',';

/** `(a, b)` or `[a, b]`: one bracket pair around the whole text. */
function wrapsWhole(text: string): boolean {
  if (!/^[([]/.test(text)) return false;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (OPENERS.includes(text[index]!)) depth += 1;
    else if (CLOSERS.includes(text[index]!)) depth -= 1;
    if (depth === 0) return index === text.length - 1;
  }
  return false;
}

/** The plain names an assignment target binds: `a`, `a, b`, `(a, *rest)`; attributes and items bind none. */
function targetNames(target: string, out: string[]): void {
  let text = target.trim().replace(/^\*/, '').trim();
  // An annotation (`x: int`) leaves the name before it.
  text = splitTop(text, (value, index) => value[index] === ':')[0]!.trim();
  const wrapped = wrapsWhole(text);
  const inner = wrapped ? text.slice(1, -1) : text;
  const items = splitTop(inner, isComma).filter((item) => item.trim());
  if (items.length > 1 || wrapped) {
    for (const item of items) targetNames(item, out);
    return;
  }
  if (IDENTIFIER.test(text)) out.push(text);
}

const COMPOUND = /^(?:if|elif|else|for|while|with|try|except|finally|async\s+(?:for|with)|return|del|assert|raise|global|nonlocal|pass|break|continue)\b/;
// Soft keywords: `match x:` opens a block, `match = re.search(...)` binds a name.
const SOFT_COMPOUND = /^(?:match|case)\b.*:$/;

/**
 * Names a Python cell binds at module level: functions, classes, import
 * aliases and assignment targets, chained ones included.
 */
export function pythonMadeNames(source: string): string[] {
  const names: string[] = [];
  for (const { code, topLevel } of pythonStatements(source)) {
    if (!topLevel) continue;
    const text = code.trim();
    const definition = /^(?:async\s+def|def|class)\s+([\p{L}_][\p{L}\p{N}_]*)/u.exec(text);
    if (definition) {
      names.push(definition[1]!);
      continue;
    }
    // An import names what the cell makes only through its alias; a plain import is the library's name.
    const imported = /^(?:from\s+\S+\s+)?import\s+(.+)$/.exec(text);
    if (imported) {
      for (const part of imported[1]!.replace(/[()]/g, '').split(',')) {
        const alias = part.trim().split(/\s+as\s+/)[1];
        if (alias && IDENTIFIER.test(alias)) names.push(alias);
      }
      continue;
    }
    if (COMPOUND.test(text) || SOFT_COMPOUND.test(text) || text.startsWith('@')) continue;
    const augmented = /^([\p{L}_][\p{L}\p{N}_]*)\s*(?:\*\*|\/\/|>>|<<|[-+*/%@&|^])=(?!=)/u.exec(text);
    if (augmented) {
      names.push(augmented[1]!);
      continue;
    }
    const parts = splitTop(text, isAssign);
    // A lambda's defaults (`f = lambda a, b=1: a`) are not targets.
    const lambda = parts.findIndex((part) => /\blambda\b/.test(part));
    for (const target of parts.slice(0, lambda === -1 ? -1 : lambda)) targetNames(target, names);
  }
  return [...new Set(names)];
}

// Cells are immutable, so an unchanged cell keeps its chips (and their identity) across edits elsewhere.
const restoredCache = new WeakMap<NotebookCellV1, { readonly prior: string; readonly flow: NotebookVarFlow }>();

function restoredFlow(cell: NotebookCellV1, made: ReadonlySet<string>): NotebookVarFlow {
  const prior = [...made].join('\n');
  const hit = restoredCache.get(cell);
  if (hit?.prior === prior) return hit.flow;
  const flow = { uses: deriveUsesKeys(cell.source, [...made], 'python'), produces: pythonMadeNames(cell.source) };
  restoredCache.set(cell, { prior, flow });
  return flow;
}

/**
 * Python chips for cells that ran before this session (a reload, a restart):
 * read from their source, since the kernel that ran them is gone.
 */
export function restoredPythonVarFlow(
  cells: ReadonlyArray<NotebookCellV1>,
  current: Readonly<Record<string, NotebookVarFlow>> | undefined,
  statuses: Readonly<Record<string, NotebookCellRunStatus>> | undefined,
  order: Readonly<Record<string, number>> | undefined
): Readonly<Record<string, NotebookVarFlow>> | undefined {
  let restored: Record<string, NotebookVarFlow> | undefined;
  const made = new Set<string>();
  for (const cell of cells) {
    if (cell.kind !== 'code' || cell.language !== 'python') continue;
    let flow = current?.[cell.id];
    if (!flow && hasNotebookExecutionEvidence(cell, statuses?.[cell.id], order?.[cell.id])) {
      flow = restoredFlow(cell, made);
      restored ??= { ...current };
      restored[cell.id] = flow;
    }
    for (const name of flow?.produces ?? []) made.add(name);
  }
  return restored ?? current;
}
