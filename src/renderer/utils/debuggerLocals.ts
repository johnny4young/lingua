import type { LineResult } from '../stores/resultStore';

/** How one local differs from the pause before it. */
export type LocalChange = { readonly kind: 'new' } | { readonly kind: 'changed'; readonly before: string };

type Locals = Readonly<Record<string, string>>;

/** The locals that are new or hold a different value since `previous`; none on the first pause. */
export function localsChanges(previous: Locals | null | undefined, current: Locals): Map<string, LocalChange> {
  const changes = new Map<string, LocalChange>();
  if (!previous) return changes;
  for (const [name, value] of Object.entries(current)) {
    if (!Object.hasOwn(previous, name)) changes.set(name, { kind: 'new' });
    else if (previous[name] !== value) changes.set(name, { kind: 'changed', before: previous[name]! });
  }
  return changes;
}

/** Locals in the order they had at the previous pause, new ones after, so rows do not jump between steps. */
export function orderedLocals(previous: Locals | null | undefined, current: Locals): [string, string][] {
  const names = Object.keys(current);
  if (!previous) return names.map((name) => [name, current[name]!]);
  const known = Object.keys(previous).filter((name) => Object.hasOwn(current, name));
  const added = names.filter((name) => !Object.hasOwn(previous, name));
  return [...known, ...added].map((name) => [name, current[name]!]);
}

const LABEL_VALUES = 3;
const LABEL_VALUE_LENGTH = 40;

/** `name → value` for the first changes since `previous`, on one line; null when nothing changed. */
export function changedValuesLabel(previous: Locals | null | undefined, current: Locals): string | null {
  const names = [...localsChanges(previous, current).keys()];
  if (names.length === 0) return null;
  const shown = names.slice(0, LABEL_VALUES).map((name) => {
    const value = current[name]!.replace(/\s+/g, ' ');
    return `${name} → ${value.length > LABEL_VALUE_LENGTH ? `${value.slice(0, LABEL_VALUE_LENGTH - 1)}…` : value}`;
  });
  return `${shown.join('  ·  ')}${names.length > LABEL_VALUES ? '  …' : ''}`;
}

/** A name not preceded by a word character or a dot, so neither part of a longer name nor a property. */
const IDENTIFIER = /(?<![\w$.])[A-Za-z_$][\w$]*/g;

/** The line with string contents and the trailing comment blanked out; `${…}` in a template literal stays code. */
function codeOf(line: string, python: boolean): string {
  let out = '';
  let quote: string | null = null;
  // Open braces inside each `${` we are in, innermost last.
  const templates: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (quote === '`' && ch === '$' && line[i + 1] === '{') {
        quote = null;
        templates.push(0);
        i += 1;
      } else if (ch === quote) quote = null;
      out += ' ';
      continue;
    }
    if (templates.length > 0 && (ch === '{' || ch === '}')) {
      const open = templates.pop()!;
      if (ch === '{') templates.push(open + 1);
      else if (open > 0) templates.push(open - 1);
      else quote = '`';
      out += ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || (!python && ch === '`')) {
      quote = ch;
      out += ' ';
      continue;
    }
    if (python ? ch === '#' : ch === '/' && line[i + 1] === '/') break;
    out += ch;
  }
  return out;
}

/** Locals the line's code names, in the order it names them. */
export function localsOnLine(line: string, locals: Locals, language: string): string[] {
  const names: string[] = [];
  for (const [name] of codeOf(line, language === 'python').matchAll(IDENTIFIER)) {
    if (Object.hasOwn(locals, name) && !names.includes(name)) names.push(name);
  }
  return names;
}

interface Pause {
  readonly tabId: string;
  readonly line: number;
  readonly locals: Locals;
}

/**
 * Inline values for a pause: the locals the paused line names, and what the
 * last step changed after the line it stepped from.
 */
export function pausedLineResults(frame: Pause, previous: Pause | null, code: string, language: string): LineResult[] {
  const lines = code.split('\n');
  const byLine = new Map<number, string[]>();
  const add = (line: number, names: Iterable<string>) => {
    if (!Number.isInteger(line) || line < 1 || line > lines.length) return;
    const list = byLine.get(line) ?? [];
    for (const name of names) if (!list.includes(name)) list.push(name);
    if (list.length > 0) byLine.set(line, list);
  };
  add(frame.line, localsOnLine(lines[frame.line - 1] ?? '', frame.locals, language));
  if (previous?.tabId === frame.tabId) add(previous.line, localsChanges(previous.locals, frame.locals).keys());
  return [...byLine].flatMap(([line, names]) => names.map((name) => ({ line, name, value: frame.locals[name]!, type: 'log' as const })));
}
