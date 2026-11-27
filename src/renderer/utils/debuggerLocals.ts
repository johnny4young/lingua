import type { PausedFrame } from '../stores/debuggerStore';
import type { LineResult } from '../stores/resultStore';
import { MODULE_FRAME } from './debuggerStack';
import { closingParen } from './magicComments/jsAssignments';

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
  readonly depth: number;
  readonly frame?: string;
  readonly callStack?: PausedFrame['callStack'];
  /** Lines the paused invocation started; without them no line above the pause reads as run. */
  readonly frameLines?: readonly number[];
}

const CALL_TEXT_LENGTH = 32;
const CHAIN_NAMES = 3;

/** The `index`th call of `name` on the line as written, such as `quickSort(left)`; `name(…)` when it is not there or too long. */
export function callOnLine(line: string, name: string, index: number, language: string): string {
  const callee = name.slice(name.lastIndexOf('.') + 1);
  const fallback = `${callee}(…)`;
  if (!/^[A-Za-z_$][\w$]*$/.test(callee)) return fallback;
  const code = codeOf(line, language === 'python');
  const starts = [...code.matchAll(new RegExp(`(?<![\\w$])${callee.replace(/\$/g, '\\$')}\\s*\\(`, 'g'))];
  const match = starts[Math.min(Math.max(index, 1), starts.length) - 1];
  if (!match) return fallback;
  const close = closingParen(code, match.index + match[0].length - 1);
  if (close < 0) return fallback;
  const text = line.slice(match.index, close + 1).replace(/\s+/g, ' ');
  return text.length > CALL_TEXT_LENGTH ? fallback : text;
}

/** The paused invocation's lines above the pause: a function's declaration line binds its parameters. */
function ranLines(frame: Pause): number[] {
  const top = frame.callStack?.[0];
  if (!frame.frameLines || !top) return [];
  const lines = new Set(frame.frameLines.filter(line => line < frame.line));
  if (top.declarationLine !== undefined && top.declarationLine < frame.line) lines.add(top.declarationLine);
  return [...lines].sort((a, b) => a - b);
}

/** What each calling frame waits on, on the line it is running; the top level reads the calls it started. */
function callerResults(frame: Pause, lines: readonly string[], language: string, taken: Set<number>): LineResult[] {
  const stack = frame.callStack ?? [];
  const results: LineResult[] = [];
  for (let index = 1; index < stack.length; index += 1) {
    const caller = stack[index]!;
    const callee = stack[index - 1]!;
    if (taken.has(caller.line) || !Number.isInteger(caller.line) || caller.line < 1 || caller.line > lines.length) continue;
    taken.add(caller.line);
    if (caller.functionName === MODULE_FRAME && index === stack.length - 1) {
      const names = stack.slice(0, -1).map(entry => entry.functionName).reverse();
      const chain = names.length > CHAIN_NAMES ? [names[0]!, '…', names.at(-1)!] : names;
      results.push({ line: caller.line, value: chain.join(' → '), type: 'log', frameCall: { kind: 'calling', depth: frame.depth } });
    } else {
      const call = callOnLine(lines[caller.line - 1]!, callee.functionName, callee.callIndex ?? 1, language);
      const depth = stack.length - 1 - index;
      results.push({ line: caller.line, value: call, type: 'log', depth, frameCall: { kind: 'waiting', thisCall: index === 1 } });
    }
  }
  return results;
}

/**
 * Inline values for a pause. The paused line shows the locals it names, held
 * before it runs. The line the last pause stopped on shows what changed since.
 * Each calling frame's line says what it waits on. When the last pause was in
 * another frame, its line keeps the values it read there with their depth.
 * Lines of the paused frame that already ran show the current value of the
 * locals they name first. With `compare`, a changed value carries the one it replaced.
 */
export function pausedLineResults(frame: Pause, previous: Pause | null, code: string, language: string, compare = true): LineResult[] {
  const lines = code.split('\n');
  const inRange = (line: number) => Number.isInteger(line) && line >= 1 && line <= lines.length;
  const results: LineResult[] = [];
  const before = previous?.tabId === frame.tabId ? previous : null;
  const sameFrame = before !== null && before.depth === frame.depth && before.frame === frame.frame;
  // Only the same function's locals can be compared; a recursive call of it can.
  const comparable = compare && before !== null && before.frame === frame.frame;
  const withPrevious = (name: string, value: string): Pick<LineResult, 'previous'> => {
    const old = comparable ? before.locals[name] : undefined;
    return old !== undefined && old !== value ? { previous: old } : {};
  };
  const shown = new Set<string>();
  if (inRange(frame.line)) {
    for (const name of localsOnLine(lines[frame.line - 1]!, frame.locals, language)) {
      const value = frame.locals[name]!;
      shown.add(`${frame.line}:${name}`);
      results.push({ line: frame.line, name, value, type: 'log', held: true, ...withPrevious(name, value) });
    }
  }
  const taken = new Set(results.map(result => result.line));
  if (before && inRange(before.line) && sameFrame) {
    for (const name of localsChanges(before.locals, frame.locals).keys()) {
      if (shown.has(`${before.line}:${name}`)) continue;
      const value = frame.locals[name]!;
      results.push({ line: before.line, name, value, type: 'log', ...withPrevious(name, value) });
      taken.add(before.line);
    }
  }
  results.push(...callerResults(frame, lines, language, taken));
  if (before && inRange(before.line) && !sameFrame && !taken.has(before.line)) {
    for (const name of localsOnLine(lines[before.line - 1]!, before.locals, language)) {
      if (shown.has(`${before.line}:${name}`)) continue;
      results.push({ line: before.line, name, value: before.locals[name]!, type: 'log', depth: before.depth });
      taken.add(before.line);
    }
  }
  const answered = new Set<string>();
  for (const line of ranLines(frame)) {
    if (taken.has(line)) continue;
    for (const name of localsOnLine(lines[line - 1]!, frame.locals, language)) {
      if (answered.has(name)) continue;
      answered.add(name);
      const value = frame.locals[name]!;
      results.push({ line, name, value, type: 'log', ...withPrevious(name, value) });
    }
  }
  return results;
}
