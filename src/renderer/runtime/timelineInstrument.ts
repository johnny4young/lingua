import { Parser } from 'acorn';
import MagicString from 'magic-string';
import { TIMELINE_MAX_VARS } from '../../shared/timeline';
import { HOISTED, MAX_NESTING, isFunction, isInjected, isNode, statementList, type AcornNode } from './instrumentAst';
import {
  buildLineTranslator,
  buildLocalSnapshotExpression,
  collectLocalIdentifiers,
  ownEndLine,
  type LineTranslator,
} from './debuggerInstrument';

// Record run: a synchronous `__lingua_rec(line, locals, end?)` before every statement, on the same line, so nothing pauses;
// `end` is the statement's last own line when it spans several, as the debugger reports it.
// Async functions and generators get no frame because their bodies interleave with other code.
export interface TimelineInstrumentResult {
  code: string;
  map: string;
}

const INTERNAL_NAME = /^(__lp\d+|__lingua_|__mc)/;

function namesOf(nodes: AcornNode[]): string[] {
  return collectLocalIdentifiers({ type: 'BlockStatement', body: nodes });
}

function scopeFor(node: AcornNode, scope: string[]): string[] {
  if (isFunction(node)) return collectLocalIdentifiers(node);
  switch (node.type) {
    case 'Program':
      return collectLocalIdentifiers(node);
    case 'BlockStatement':
    case 'StaticBlock':
      return [...scope, ...collectLocalIdentifiers(node)];
    case 'ForStatement':
      return node.init?.type === 'VariableDeclaration' ? [...scope, ...namesOf([node.init])] : scope;
    case 'ForInStatement':
    case 'ForOfStatement':
      return node.left?.type === 'VariableDeclaration' ? [...scope, ...namesOf([node.left])] : scope;
    case 'CatchClause':
      return node.param ? [...scope, ...collectLocalIdentifiers({ params: [node.param], body: [] })] : scope;
    default:
      return scope;
  }
}

function functionName(node: AcornNode, parent: AcornNode | null): string {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id?.name) return parent.id.name;
  if ((parent?.type === 'MethodDefinition' || parent?.type === 'Property') && parent.key?.name) return parent.key.name;
  return '<anonymous>';
}

function snapshotFor(scope: string[]): string {
  const names = [...new Set(scope)].filter(name => !INTERNAL_NAME.test(name)).slice(0, TIMELINE_MAX_VARS);
  return buildLocalSnapshotExpression(names);
}

/** `var` names a body declares, nested blocks included, functions excluded. */
function varNames(node: AcornNode, names = new Set<string>()): Set<string> {
  if (!isNode(node) || isFunction(node)) return names;
  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const name of namesOf([node])) names.add(name);
  }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) for (const child of value) varNames(child, names);
    else if (isNode(value)) varNames(value, names);
  }
  return names;
}

/** Inside `try {}` a function declaration turns lexical, so one that shares a `var` name would no longer parse. */
function canWrapBody(body: AcornNode): boolean {
  const functions = body.body.filter((stmt: AcornNode) => stmt.type === 'FunctionDeclaration').map((stmt: AcornNode) => stmt.id?.name);
  if (functions.length === 0) return true;
  const vars = new Set<string>();
  for (const stmt of body.body) varNames(stmt, vars);
  return !functions.some((name: string | undefined) => name !== undefined && vars.has(name));
}

const BODY_KEYS = new Set(['consequent', 'alternate', 'body']);

/** First line of a nested body that records no step of its own: a branch or loop body without braces, or an arrow's expression body on a later line. */
function firstUnrecordedLine(node: AcornNode): number | null {
  let first: number | null = null;
  const consider = (line: number | null) => {
    if (line !== null && (first === null || line < first)) first = line;
  };
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    for (const child of Array.isArray(value) ? value : [value]) {
      if (!isNode(child) || child.type === 'BlockStatement' || child.type === 'StaticBlock') continue;
      const line: number = child.loc?.start.line ?? 0;
      if (isFunction(node) && key === 'body') consider(line > node.loc.start.line ? line : firstUnrecordedLine(child));
      else if (BODY_KEYS.has(key) && /(Statement|Declaration)$/.test(child.type)) consider(line);
      else consider(firstUnrecordedLine(child));
    }
  }
  return first;
}

/** The statement's last own line, stopping before a body it would otherwise claim as run. */
function recordedEndLine(stmt: AcornNode, line: number, translate: LineTranslator): number {
  const end = ownEndLine(stmt, line, translate);
  const stop = firstUnrecordedLine(stmt);
  return stop !== null && stop > stmt.loc.start.line ? Math.max(line, Math.min(end, translate(stop - 1))) : end;
}

function wrapFrame(node: AcornNode, parent: AcornNode | null, ms: MagicString, translate: LineTranslator): void {
  const body = node.body;
  if (body?.type !== 'BlockStatement' || body.body.length === 0 || node.async || node.generator || !canWrapBody(body)) return;
  const firstCode = body.body.find((stmt: AcornNode) => !(stmt.type === 'ExpressionStatement' && typeof stmt.directive === 'string'));
  if (!firstCode) return;
  const line = translate(node.loc.start.line);
  ms.appendLeft(firstCode.start, `__lingua_rec_enter(${JSON.stringify(functionName(node, parent))}, ${line}); try { `);
  ms.prependRight(body.end - 1, ` } finally { __lingua_rec_exit(); }`);
}

function walk(node: AcornNode, parent: AcornNode | null, scope: string[], ms: MagicString, translate: LineTranslator, nesting: number): void {
  if (nesting > MAX_NESTING) return;
  const nextScope = scopeFor(node, scope);
  if (isFunction(node)) wrapFrame(node, parent, ms, translate);

  const list = statementList(node);
  if (list) {
    const snapshot = snapshotFor(nextScope);
    for (const stmt of list) {
      if (HOISTED.has(stmt.type) || isInjected(stmt)) continue;
      const line = translate(stmt.loc?.start.line ?? 0);
      if (!Number.isInteger(line) || line <= 0) continue;
      const end = recordedEndLine(stmt, line, translate);
      ms.appendLeft(stmt.start, `__lingua_rec(${line}, () => ${snapshot}${end > line ? `, ${end}` : ''}); `);
    }
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, node, nextScope, ms, translate, nesting + 1);
    } else if (isNode(value)) {
      walk(value, node, nextScope, ms, translate, nesting + 1);
    }
  }
}

/** Throws acorn's SyntaxError for malformed code, like the debugger instrumenter. */
export function instrumentForTimeline(
  code: string,
  options: { inputMap?: string; filename?: string } = {}
): TimelineInstrumentResult {
  const filename = options.filename ?? 'user-code.js';
  const ast = Parser.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
  const ms = new MagicString(code, { filename });
  walk(ast, null, [], ms, buildLineTranslator(options.inputMap), 0);
  return {
    code: ms.toString(),
    map: ms.generateMap({ source: filename, includeContent: true, hires: true }).toString(),
  };
}
