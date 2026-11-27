import { Parser } from 'acorn';
import MagicString from 'magic-string';
import type { LiveLoopSpan } from '../../shared/liveRun';
import { buildLineTranslator, type LineTranslator } from './debuggerInstrument';
import { HOISTED, MAX_NESTING, isFunction, isInjected, isNode, statementList, type AcornNode } from './instrumentAst';

/**
 * Live run signal: `__lingua_live(line)` before every statement that can take
 * time, and around each loop `__lingua_loop(id, readPass)` / `__lingua_loop_end(id)`
 * with a pass counter at the start of its body. Everything stays on the
 * statement's own line. A loop that binds one name each pass copies it into a
 * slot the tracker reads. A statement with no call, `new`, `await` or `yield` is
 * not probed: it cannot hold the run, and a hot loop of them would pay for it.
 * Loops in async functions and generators are not tracked: they suspend with
 * the loop open while other code runs, so a stack of open loops would lie.
 */
export interface LiveInstrumentResult {
  code: string;
  map: string;
  /** Header and body end line of each loop, by id. */
  loops: LiveLoopSpan[];
}

/** A power of two; the first pass calls too, so a slow loop reports its first pass. */
const PASSES_PER_CALL = 128;
const LOOPS = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement']);
const INTERNAL_CALL = /^__(mc_tick|lingua_)/;
const TAKES_TIME = new Set(['CallExpression', 'NewExpression', 'AwaitExpression', 'YieldExpression', 'TaggedTemplateExpression', 'ImportExpression']);

/** Timing ticks and scope capture are injected too. */
function isInternal(stmt: AcornNode): boolean {
  if (isInjected(stmt)) return true;
  const callee = stmt.type === 'ExpressionStatement' && stmt.expression?.type === 'CallExpression' ? stmt.expression.callee : null;
  return callee?.type === 'Identifier' && INTERNAL_CALL.test(callee.name);
}

/** Whether running `node` itself can call out or wait; nested function bodies do not count. */
function takesTime(node: AcornNode, nesting = 0): boolean {
  if (!isNode(node) || nesting > MAX_NESTING || isFunction(node) || node.type === 'ClassBody') return false;
  if (TAKES_TIME.has(node.type)) return true;
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === '__parent') continue;
    const value = node[key];
    for (const child of Array.isArray(value) ? value : [value]) if (takesTime(child, nesting + 1)) return true;
  }
  return false;
}

/** The statement's own work, without the statements it contains. */
function holdsRun(stmt: AcornNode): boolean {
  let inner = stmt;
  while (inner.type === 'LabeledStatement') inner = inner.body;
  if (LOOPS.has(inner.type) || inner.type === 'ThrowStatement') return true;
  switch (inner.type) {
    case 'ExpressionStatement':
      return takesTime(inner.expression);
    case 'VariableDeclaration':
      return inner.declarations.some((decl: AcornNode) => takesTime(decl.init) || takesTime(decl.id));
    case 'ReturnStatement':
      return takesTime(inner.argument);
    case 'IfStatement':
      return takesTime(inner.test);
    case 'SwitchStatement':
      return takesTime(inner.discriminant);
    default:
      return false;
  }
}

interface WalkState {
  readonly ms: MagicString;
  readonly translate: LineTranslator;
  readonly maxLine: number;
  readonly loops: LiveLoopSpan[];
}

function userLine(stmt: AcornNode, state: WalkState, edge: 'start' | 'end' = 'start'): number {
  const line = state.translate(stmt.loc?.[edge].line ?? 0);
  return Number.isInteger(line) && line > 0 && line <= state.maxLine ? line : 0;
}

function probe(stmt: AcornNode, state: WalkState): string {
  if (HOISTED.has(stmt.type) || isInternal(stmt) || !holdsRun(stmt)) return '';
  const line = userLine(stmt, state);
  return line > 0 ? `__lingua_live(${line}); ` : '';
}

/** The one name a loop binds each pass (`for (const x of xs)`, `for (let i = 0; …)`), or null. */
function loopBinding(node: AcornNode): string | null {
  const head = node.type === 'ForStatement' ? node.init : node.type === 'ForOfStatement' || node.type === 'ForInStatement' ? node.left : null;
  if (head?.type === 'Identifier') return head.name;
  if (head?.type !== 'VariableDeclaration' || head.declarations.length !== 1) return null;
  const id = head.declarations[0].id;
  return id?.type === 'Identifier' ? id.name : null;
}

/** A body block that declares `name` again would hit its own TDZ if the pass read the name first. */
function redeclares(body: AcornNode, name: string): boolean {
  if (body.type !== 'BlockStatement') return false;
  return body.body.some(
    (stmt: AcornNode) =>
      (stmt.type === 'VariableDeclaration' && stmt.declarations.some((decl: AcornNode) => declaresName(decl.id, name))) ||
      ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id?.name === name)
  );
}

function declaresName(pattern: AcornNode | null | undefined, name: string, nesting = 0): boolean {
  if (!isNode(pattern) || nesting > MAX_NESTING) return false;
  if (pattern.type === 'Identifier') return pattern.name === name;
  if (pattern.type === 'ObjectPattern') return pattern.properties.some((prop: AcornNode) => declaresName(prop.type === 'RestElement' ? prop.argument : prop.value, name, nesting + 1));
  if (pattern.type === 'ArrayPattern') return pattern.elements.some((item: AcornNode | null) => declaresName(item, name, nesting + 1));
  if (pattern.type === 'AssignmentPattern') return declaresName(pattern.left, name, nesting + 1);
  if (pattern.type === 'RestElement') return declaresName(pattern.argument, name, nesting + 1);
  return false;
}

function wrapLoop(node: AcornNode, target: AcornNode, state: WalkState): void {
  const line = userLine(node, state);
  if (line === 0) return;
  const id = state.loops.length;
  state.loops.push({ line, end: Math.max(line, userLine(node.body, state, 'end')) });
  const { ms } = state;
  const counter = `__lingua_p${id}`;
  const name = loopBinding(node);
  const binding = name !== null && !redeclares(node.body, name) ? { name, slot: `__lingua_b${id}` } : null;
  // The pass and the loop variable live in block-scoped slots the tracker reads; the call comes every PASSES_PER_CALL passes.
  const slot = binding ? `, ${binding.slot}` : '';
  const read = binding ? `, () => ${binding.slot}, ${JSON.stringify(binding.name)}` : '';
  ms.appendLeft(target.start, `{ let ${counter} = 0${slot}; __lingua_loop(${id}, () => ${counter}${read}); try { `);
  // Closes are prepended, so a loop nested at the same end closes first.
  ms.prependLeft(target.end, ` } finally { __lingua_loop_end(${id}); } }`);
  if (node.type === 'ForOfStatement') {
    // Parenthesized, so a sequence such as (a, b) stays one argument.
    ms.appendLeft(node.right.start, `__lingua_of(${id}, (`);
    ms.prependLeft(node.right.end, '))');
  }
  const body = node.body;
  const pass = `${binding ? `${binding.slot} = ${binding.name}; ` : ''}if ((++${counter} & ${PASSES_PER_CALL - 1}) === 1) __lingua_pass();`;
  if (body.type === 'BlockStatement') {
    ms.appendLeft(body.start + 1, ` ${pass}`);
  } else {
    ms.appendLeft(body.start, `{ ${pass} ${probe(body, state)}`);
    ms.prependLeft(body.end, ' }');
  }
}

function walk(node: AcornNode, parent: AcornNode | null, tracked: boolean, state: WalkState, nesting: number): void {
  if (nesting > MAX_NESTING) return;
  const inner = isFunction(node) ? !node.async && !node.generator : tracked;

  const list = statementList(node);
  if (list) {
    for (const stmt of list) {
      const text = probe(stmt, state);
      if (text) state.ms.appendLeft(stmt.start, text);
    }
  }

  if (LOOPS.has(node.type) && tracked) {
    let target = node;
    let up = parent;
    while (up?.type === 'LabeledStatement' && up.body === target) {
      target = up;
      up = up.__parent;
    }
    wrapLoop(node, target, state);
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === '__parent') continue;
    const value = node[key];
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (!isNode(child)) continue;
      child.__parent = node;
      walk(child, node, inner, state, nesting + 1);
    }
  }
}

/** Throws acorn's SyntaxError for malformed code, like the other instrumenters. */
export function instrumentForLive(
  code: string,
  options: { inputMap?: string; filename?: string; maxLine?: number } = {}
): LiveInstrumentResult {
  const filename = options.filename ?? 'user-code.js';
  const ast = Parser.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });
  const ms = new MagicString(code, { filename });
  const loops: LiveLoopSpan[] = [];
  walk(ast, null, true, { ms, translate: buildLineTranslator(options.inputMap), maxLine: options.maxLine ?? Number.MAX_SAFE_INTEGER, loops }, 0);
  return {
    code: ms.toString(),
    map: ms.generateMap({ source: filename, hires: 'boundary' }).toString(),
    loops,
  };
}

/** The runners' entry: null when the code does not parse, so the run still goes without the signal. */
export function tryInstrumentForLive(
  code: string,
  options: { inputMap?: string; filename?: string; maxLine?: number }
): LiveInstrumentResult | null {
  try {
    return instrumentForLive(code, options);
  } catch {
    return null;
  }
}
