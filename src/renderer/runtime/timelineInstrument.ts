/* eslint-disable @typescript-eslint/no-explicit-any */
import { Parser } from 'acorn';
import MagicString from 'magic-string';
import { TIMELINE_MAX_VARS } from '../../shared/timeline';
import {
  buildLineTranslator,
  buildLocalSnapshotExpression,
  collectLocalIdentifiers,
  type LineTranslator,
} from './debuggerInstrument';

type AcornNode = any;

// Record run: a synchronous `__lingua_rec(line, locals)` before every statement, on the same line, so nothing pauses.
// Async functions and generators get no frame because their bodies interleave with other code.
export interface TimelineInstrumentResult {
  code: string;
  map: string;
}

const MAX_NESTING = 400;
const INTERNAL_NAME = /^(__lp\d+|__lingua_|__mc)/;

const HOISTED = new Set([
  'FunctionDeclaration',
  'ClassDeclaration',
  'ImportDeclaration',
  'ExportAllDeclaration',
  'ExportNamedDeclaration',
  'ExportDefaultDeclaration',
  'EmptyStatement',
]);

function isNode(value: unknown): value is AcornNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function isFunction(node: AcornNode): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

/** Loop protection's counter and guard statements are not the user's steps. */
function isInjected(stmt: AcornNode): boolean {
  if (stmt.type === 'VariableDeclaration') {
    return stmt.declarations.every((decl: AcornNode) => /^__lp\d+$/.test(decl.id?.name ?? ''));
  }
  if (stmt.type === 'IfStatement') {
    const left = stmt.test?.left;
    return left?.type === 'UpdateExpression' && /^__lp\d+$/.test(left.argument?.name ?? '');
  }
  return stmt.type === 'ExpressionStatement' && typeof stmt.directive === 'string';
}

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

function statementList(node: AcornNode): AcornNode[] | null {
  if (node.type === 'Program' || node.type === 'BlockStatement' || node.type === 'StaticBlock') return node.body;
  if (node.type === 'SwitchCase') return node.consequent;
  return null;
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
      ms.appendLeft(stmt.start, `__lingua_rec(${line}, () => ${snapshot}); `);
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
