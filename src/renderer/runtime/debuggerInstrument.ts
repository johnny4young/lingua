import { Parser } from 'acorn';
import MagicString from 'magic-string';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Acorn's exported types are loose; we cast to a structural shape per
// node type as we walk. This is the same pattern Vite plugins use.
type AcornAst = any;
type AcornNode = any;

interface AwaitableDebugTargets {
  names: Set<string>;
  nodes: WeakSet<AcornNode>;
}

/**
 * RL-027 Slice 1 — Source instrumentation for the JS/TS debugger.
 *
 * # What this does
 *
 * Takes JS source (already TS-stripped by esbuild-wasm if the user
 * authored TypeScript) and rewrites it so every executable statement
 * is preceded by an `await __lingua_dbg_yield(line, () => locals)`
 * call. The worker injects `__lingua_dbg_yield` as a closure parameter
 * (mirror of the existing `__mc` magic-comment helper), so each yield
 * sees the live local-scope binding without us having to rebuild a
 * scope chain at injection time.
 *
 * # Why acorn + magic-string (not esbuild plugin or regex)
 *
 * - **acorn** parses ECMAScript correctly, including async / await /
 *   generators / decorators / class fields / TC39 stage-4 features.
 *   A regex-based approach would corrupt template literals, strings
 *   that contain newlines, and any line that spans multiple
 *   statements (`a = 1; b = 2`).
 * - **magic-string** mutates the source by character index and
 *   produces a JS→JS source map automatically. Slice 1 returns that
 *   map as-is; Slice 1.5 composes it with esbuild's TS→JS map so a
 *   breakpoint set in `.ts` line N maps back to TS line N at pause
 *   time.
 * - esbuild's `transform` API does NOT expose AST — only string-level
 *   loaders and parser modes. Not a fit.
 * - Both libs are already transitive via Vite/Rollup; this slice
 *   promotes them to direct `dependencies` for clarity.
 *
 * # What gets a yield
 *
 * - Top-level statements in the program body.
 * - Top-level statements inside async function / arrow / method bodies.
 *
 * What does NOT get a yield (intentional — would either break code
 * or yield in places where the user can't reasonably set a breakpoint):
 *
 * - Inside expressions (a yield in the middle of `a + b` would change
 *   evaluation order).
 * - Class field initializers (run before the constructor in a way
 *   that breaks `await` — must stay synchronous).
 * - Synchronous function bodies. Injecting `await` into them would
 *   turn valid code into a SyntaxError unless the whole call graph is
 *   rewritten to async, which is outside Slice 1.
 * - Generator function bodies (yield-await mismatch is hairy; the
 *   user-facing impact is "set the breakpoint on the line that
 *   *calls* the generator instead").
 * - Statements injected by us (idempotency — the `__lingua_dbg_yield`
 *   call is itself a statement; we'd loop forever).
 *
 * # Source map merge
 *
 * Slice 1.5 fold G — when the caller passes `inputMap` (esbuild's
 * TS→JS map from the TypeScript runner), we wrap it in a
 * `@jridgewell/trace-mapping` `TraceMap` and translate every line we
 * see in the AST from the post-transpile JS coordinate space back to
 * the user's TS line via `originalPositionFor`. The translated line
 * is what we inject into the yield helper call AND what we record in
 * `instrumentedLines`, so the worker's breakpoint match against the
 * user-typed breakpoints (which were always TS lines stored in
 * `debuggerStore`) just works.
 *
 * For pure JS (no `inputMap`), the translator is a passthrough — the
 * AST's line numbers are already in the user's coordinate space.
 *
 * # Performance
 *
 * Acorn parse: ~5-15 ms for a 200 LOC program. magic-string mutate:
 * <1 ms. Worker yield call when no breakpoint matches: a single
 * `Set.has` + `await Promise.resolve()` — about 1 µs. The fast path
 * is "no breakpoints set for this run" — when the breakpoint set is
 * empty we skip instrumentation entirely (caller-controlled flag).
 *
 * # Reference
 *
 * `docs/PLAN.md` RL-027 Slice 1 and `docs/DEBUGGER_ADR.md`.
 */

export interface InstrumentResult {
  /** Instrumented JS code, ready to send to the worker. */
  code: string;
  /**
   * JSON-encoded source map for magic-string's JS→JS diff. Slice 1
   * intentionally does not compose the caller-provided `inputMap`;
   * TypeScript line round-trip lands in Slice 1.5.
   */
  map: string;
  /**
   * Lines that received a yield. Used by the runner to short-circuit
   * the pause loop when the worker yields on a line that nobody asked
   * about.
   */
  instrumentedLines: number[];
  /**
   * Best-effort map from generated/instrumented JS lines back to the
   * user's source lines. The worker uses this for console output so
   * logs emitted during a debug run stay aligned with Monaco instead
   * of drifting after injected `await __lingua_dbg_yield(...)` calls.
   */
  sourceLineMap: Record<number, number>;
}

export interface InstrumentOptions {
  /**
   * The yield helper's parameter name in the generated code. The
   * worker injects this as a closure parameter on the
   * `AsyncFunction` constructor so the user's code does not have to
   * import anything.
   *
   * Default: `__lingua_dbg_yield`. Tests override to assert the
   * symbol travels end-to-end.
   */
  yieldHelperName?: string;
  /**
   * Slice 1.5 fold G — when supplied, this is the upstream esbuild
   * TS→JS source map. We wrap it in `@jridgewell/trace-mapping` and
   * translate every JS line the AST yields to the original TS line
   * before injecting the yield call. The yield helper therefore fires
   * with the TS line, which the worker matches directly against the
   * user's TS-line breakpoints stored in `debuggerStore`.
   */
  inputMap?: string;
  /**
   * Source filename used by acorn errors and the magic-string source
   * map. Cosmetic — the worker doesn't read it.
   */
  filename?: string;
}

const DEFAULT_HELPER_NAME = '__lingua_dbg_yield';

/**
 * Slice 1.5 fold G — line translator. JS line in, user-source line
 * out. Passes through when no input map was provided (pure-JS path).
 * A failed lookup (e.g. line outside any segment in the map) falls
 * back to returning the JS line, which is strictly less surprising
 * than dropping the yield entirely — the user still pauses, just at
 * the post-transpile coordinate instead of the original.
 */
type LineTranslator = (jsLine: number) => number;

function buildLineTranslator(inputMap: string | undefined): LineTranslator {
  if (!inputMap) {
    return (line) => line;
  }
  let tracer: TraceMap;
  try {
    tracer = new TraceMap(inputMap);
  } catch {
    // Malformed input map — defensive fallback to passthrough rather
    // than letting the constructor exception poison the run.
    return (line) => line;
  }
  return (jsLine) => {
    if (!Number.isInteger(jsLine) || jsLine <= 0) return jsLine;
    try {
      const original = originalPositionFor(tracer, { line: jsLine, column: 0 });
      if (typeof original.line === 'number' && original.line > 0) {
        return original.line;
      }
    } catch {
      // ignore — map lookup is best-effort.
    }
    return jsLine;
  };
}

/**
 * Local-scope discovery: walk the AST and collect the names declared
 * directly in the enclosing function / program body. The yield helper
 * receives a thunk that returns these as `{ name: value }` so the
 * Variables panel can render them without re-walking the scope chain
 * inside the worker.
 *
 * # Why a thunk instead of a snapshot
 *
 * The yield happens BEFORE the statement executes. If we passed an
 * eager `{ ...locals }` we'd capture pre-statement values; the user
 * expects to see the values AS OF the breakpoint line about to run.
 * The thunk closure is evaluated by the worker only when a pause
 * actually occurs, picking up live bindings.
 *
 * # Identifiers we collect
 *
 * - `let` / `const` / `var` declared in the same body.
 * - Function parameters (including destructuring + defaults).
 * - Function declarations hoisted into the body.
 *
 * # Identifiers we skip
 *
 * - Imports (already global in the worker; renaming them is risky).
 * - Globals injected by us (`__mc`, `__lingua_dbg_yield`).
 * - Anything declared inside nested blocks the user would have to
 *   step into (TDZ semantics on `let` make eager capture wrong).
 */
function collectLocalIdentifiers(node: AcornNode): string[] {
  const seen = new Set<string>();
  const skip = new Set([
    '__mc',
    DEFAULT_HELPER_NAME,
    '__lingua_dbg_frame',
    '__lingua_dbg_pop',
    '__lingua_dbg_locals',
    'arguments',
  ]);

  function add(name: string): void {
    if (!skip.has(name)) seen.add(name);
  }

  function walkPattern(pattern: AcornNode): void {
    if (!pattern || typeof pattern !== 'object') return;
    switch (pattern.type) {
      case 'Identifier':
        add((pattern as { name: string }).name);
        return;
      case 'ObjectPattern': {
        const props = (pattern as { properties: AcornNode[] }).properties;
        for (const prop of props) {
          if (prop.type === 'Property') {
            walkPattern((prop as { value: AcornNode }).value);
          } else if (prop.type === 'RestElement') {
            walkPattern((prop as { argument: AcornNode }).argument);
          }
        }
        return;
      }
      case 'ArrayPattern': {
        const elements = (pattern as { elements: (AcornNode | null)[] }).elements;
        for (const element of elements) {
          if (element) walkPattern(element);
        }
        return;
      }
      case 'AssignmentPattern':
        walkPattern((pattern as { left: AcornNode }).left);
        return;
      case 'RestElement':
        walkPattern((pattern as { argument: AcornNode }).argument);
        return;
    }
  }

  const body = (node as { body?: AcornNode | AcornNode[] }).body;
  if (!body) return [];
  const statements = Array.isArray(body) ? body : (body as { body?: AcornNode[] }).body ?? [];

  // Collect parameters when the node is a function-like.
  const params = (node as { params?: AcornNode[] }).params;
  if (Array.isArray(params)) {
    for (const param of params) walkPattern(param);
  }

  for (const stmt of statements) {
    if (!stmt) continue;
    switch (stmt.type) {
      case 'VariableDeclaration': {
        const decls = (stmt as { declarations: AcornNode[] }).declarations;
        for (const decl of decls) {
          walkPattern((decl as { id: AcornNode }).id);
        }
        break;
      }
      case 'FunctionDeclaration': {
        const id = (stmt as { id: AcornNode | null }).id;
        if (id) walkPattern(id);
        break;
      }
      case 'ClassDeclaration': {
        const id = (stmt as { id: AcornNode | null }).id;
        if (id) walkPattern(id);
        break;
      }
    }
    collectAssignmentIdentifiers(stmt, add);
  }

  return [...seen];
}

function collectAssignmentIdentifiers(
  node: AcornNode,
  add: (name: string) => void
): void {
  if (!node || typeof node !== 'object') return;
  if (isFunctionLike(node) && node.type !== 'MethodDefinition') return;

  switch (node.type) {
    case 'AssignmentExpression':
      collectIdentifierPattern((node as { left: AcornNode }).left, add);
      break;
    case 'UpdateExpression':
      collectIdentifierPattern((node as { argument: AcornNode }).argument, add);
      break;
  }

  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAcornNode(item)) collectAssignmentIdentifiers(item as AcornNode, add);
      }
    } else if (isAcornNode(value)) {
      collectAssignmentIdentifiers(value as AcornNode, add);
    }
  }
}

function collectIdentifierPattern(
  node: AcornNode,
  add: (name: string) => void
): void {
  if (!node || typeof node !== 'object') return;
  switch (node.type) {
    case 'Identifier':
      add((node as { name: string }).name);
      return;
    case 'MemberExpression':
      collectIdentifierPattern((node as { object: AcornNode }).object, add);
      return;
    case 'ObjectPattern':
      for (const prop of (node as { properties: AcornNode[] }).properties) {
        if (prop.type === 'Property') {
          collectIdentifierPattern((prop as { value: AcornNode }).value, add);
        } else if (prop.type === 'RestElement') {
          collectIdentifierPattern((prop as { argument: AcornNode }).argument, add);
        }
      }
      return;
    case 'ArrayPattern':
      for (const element of (node as { elements: (AcornNode | null)[] }).elements) {
        if (element) collectIdentifierPattern(element, add);
      }
      return;
    case 'AssignmentPattern':
      collectIdentifierPattern((node as { left: AcornNode }).left, add);
      return;
    case 'RestElement':
      collectIdentifierPattern((node as { argument: AcornNode }).argument, add);
      return;
  }
}

function collectAwaitableDebugTargets(ast: AcornNode): AwaitableDebugTargets {
  const names = new Set<string>();
  const nodes = new WeakSet<AcornNode>();

  const visit = (node: AcornNode): void => {
    if (!isAcornNode(node)) return;

    if (node.type === 'FunctionDeclaration') {
      const id = (node as { id?: { name?: string } | null }).id;
      if (id?.name && canPromoteFunctionForDebug(node)) {
        names.add(id.name);
        nodes.add(node);
      }
    }

    if (node.type === 'VariableDeclarator') {
      const id = (node as { id?: AcornNode }).id;
      const init = (node as { init?: AcornNode | null }).init;
      if (id?.type === 'Identifier' && isFunctionLike(init) && canPromoteFunctionForDebug(init)) {
        names.add((id as { name: string }).name);
        nodes.add(init);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAcornNode(item)) visit(item as AcornNode);
        }
      } else if (isAcornNode(value)) {
        visit(value as AcornNode);
      }
    }
  };

  visit(ast);
  return { names, nodes };
}

function canPromoteFunctionForDebug(node: AcornNode): boolean {
  if (!isFunctionLike(node)) return false;
  if (node.type === 'MethodDefinition') return false;
  if ((node as { generator?: boolean }).generator === true) return false;
  const body = (node as { body?: AcornNode }).body;
  return !body || body.type === 'BlockStatement';
}

function markAwaitableDebugFunctions(
  ast: AcornNode,
  ms: MagicString,
  targets: AwaitableDebugTargets
): void {
  const visit = (node: AcornNode): void => {
    if (!isAcornNode(node)) return;
    if (
      targets.nodes.has(node) &&
      (node as { async?: boolean }).async !== true &&
      typeof node.start === 'number'
    ) {
      ms.appendLeft(node.start, 'async ');
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAcornNode(item)) visit(item as AcornNode);
        }
      } else if (isAcornNode(value)) {
        visit(value as AcornNode);
      }
    }
  };

  visit(ast);
}

function awaitKnownDebugCalls(
  ast: AcornNode,
  ms: MagicString,
  targets: AwaitableDebugTargets
): void {
  const visit = (
    node: AcornNode,
    parent: AcornNode | null,
    awaitAllowed: boolean
  ): void => {
    if (!isAcornNode(node)) return;

    let childAwaitAllowed = awaitAllowed;
    if (isFunctionLike(node)) {
      childAwaitAllowed =
        ((node as { async?: boolean }).async === true || targets.nodes.has(node)) &&
        (node as { generator?: boolean }).generator !== true;
    }

    if (
      childAwaitAllowed &&
      node.type === 'CallExpression' &&
      parent?.type !== 'AwaitExpression'
    ) {
      const callee = (node as { callee?: AcornNode }).callee;
      if (callee?.type === 'Identifier' && targets.names.has((callee as { name: string }).name)) {
        ms.prependRight(node.start, 'await ');
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAcornNode(item)) visit(item as AcornNode, node, childAwaitAllowed);
        }
      } else if (isAcornNode(value)) {
        visit(value as AcornNode, node, childAwaitAllowed);
      }
    }
  };

  visit(ast, null, true);
}

/**
 * Walk every function / arrow / program body and inject a yield call
 * before each statement. The walker is iterative (queue-based) to
 * avoid stack overflow on deeply-nested user code.
 */
function instrumentBodies(
  ast: AcornNode,
  ms: MagicString,
  helperName: string,
  recordedLines: Set<number>,
  translateLine: LineTranslator,
  awaitableTargets: AwaitableDebugTargets
): void {
  const queue: AcornNode[] = [ast];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const body = bodyStatements(node);
    wrapAsyncFunctionBody(node, ms, translateLine, awaitableTargets);

    for (const stmt of body) {
      injectYieldBefore(stmt, ms, helperName, recordedLines, node, translateLine, awaitableTargets);
      // FunctionDeclaration / FunctionExpression / ArrowFunctionExpression
      // statements are themselves the bodies we want to descend into;
      // enqueue directly. Other statements get a recursive scan for
      // nested functions.
      if (isFunctionLike(stmt)) {
        queue.push(stmt);
      } else {
        collectChildFunctions(stmt, queue);
      }
    }

    if (body.length === 0) {
      // Even when the parent has no body statements, an arrow-with-
      // expression-body might sit here and contain functions deeper.
      collectChildFunctions(node, queue);
    }
  }
}

function bodyStatements(node: AcornNode): AcornNode[] {
  // Program: body is an array directly.
  if (node.type === 'Program') {
    return ((node as { body: AcornNode[] }).body ?? []) as AcornNode[];
  }
  // FunctionDeclaration / FunctionExpression / ArrowFunctionExpression /
  // MethodDefinition value: body is a BlockStatement; its body is the
  // statement list.
  const body = (node as { body?: AcornNode | AcornNode[] }).body;
  if (!body || Array.isArray(body)) {
    return Array.isArray(body) ? (body as AcornNode[]) : [];
  }
  if ((body as AcornNode).type === 'BlockStatement') {
    return ((body as { body: AcornNode[] }).body ?? []) as AcornNode[];
  }
  return [];
}

function injectYieldBefore(
  stmt: AcornNode,
  ms: MagicString,
  helperName: string,
  recordedLines: Set<number>,
  parent: AcornNode,
  translateLine: LineTranslator,
  awaitableTargets: AwaitableDebugTargets
): void {
  // Don't instrument hoisted declarations — function declarations are
  // hoisted to the top of the scope before any statement runs, so a
  // yield in front of them would never fire (the binding already
  // exists). Skip pure declarations to keep semantics intact.
  if (
    stmt.type === 'FunctionDeclaration' ||
    stmt.type === 'ClassDeclaration' ||
    stmt.type === 'ImportDeclaration' ||
    stmt.type === 'ExportAllDeclaration' ||
    stmt.type === 'ExportNamedDeclaration' ||
    stmt.type === 'ExportDefaultDeclaration'
  ) {
    return;
  }

  // Skip generator and async-generator bodies entirely — yielding
  // inside a `function*` would conflict with the user's own `yield`
  // semantics.
  if (
    parent.type === 'FunctionDeclaration' ||
    parent.type === 'FunctionExpression'
  ) {
    if ((parent as { generator?: boolean }).generator) return;
  }

  if (!canAwaitInBody(parent, awaitableTargets)) return;

  const jsLine = stmt.loc?.start.line ?? 0;
  if (jsLine === 0) return;

  // Slice 1.5 fold G — translate JS line back to user source line so
  // the yield helper fires with the breakpoint-matching coordinate.
  const userLine = translateLine(jsLine);
  if (!Number.isInteger(userLine) || userLine <= 0) return;

  const localObject = buildLocalSnapshotExpression(collectLocalIdentifiers(parent));

  const yieldExpr = `await ${helperName}(${userLine}, () => ${localObject});`;

  // Inject BEFORE the statement. magic-string's `appendLeft` keeps
  // multiple injections at the same offset in source order, so the
  // yield ends up immediately before the original character.
  ms.appendLeft(stmt.start, `${yieldExpr}\n`);
  recordedLines.add(userLine);
}

function canAwaitInBody(parent: AcornNode, awaitableTargets: AwaitableDebugTargets): boolean {
  if (parent.type === 'Program') return true;
  if (
    parent.type === 'FunctionDeclaration' ||
    parent.type === 'FunctionExpression' ||
    parent.type === 'ArrowFunctionExpression'
  ) {
    return (
      (parent as { async?: boolean }).async === true ||
      awaitableTargets.nodes.has(parent)
    ) &&
      (parent as { generator?: boolean }).generator !== true;
  }
  return false;
}

function buildLocalSnapshotExpression(localNames: string[]): string {
  const safeNames = localNames.filter((name) => /^[$_a-zA-Z][$_a-zA-Z0-9]*$/.test(name));
  if (safeNames.length === 0) return '({})';

  const assignments = safeNames
    .map(
      (name) =>
        `try { __lingua_dbg_locals[${JSON.stringify(name)}] = ${name}; } catch {}`
    )
    .join(' ');

  return `(() => { const __lingua_dbg_locals = {}; ${assignments} return __lingua_dbg_locals; })()`;
}

function wrapAsyncFunctionBody(
  node: AcornNode,
  ms: MagicString,
  translateLine: LineTranslator,
  awaitableTargets: AwaitableDebugTargets
): void {
  if (!canAwaitInBody(node, awaitableTargets)) return;
  if (node.type === 'Program') return;
  const body = (node as { body?: AcornNode }).body;
  if (!body || body.type !== 'BlockStatement') return;

  const functionName = functionDisplayName(node);
  const jsLine = node.loc?.start.line ?? 0;
  // Slice 1.5 fold G — frame headers also report user source lines so
  // the call-stack panel matches the TS line the user sees in Monaco.
  const userLine = translateLine(jsLine);
  ms.appendLeft(
    body.start + 1,
    `\n__lingua_dbg_frame(${JSON.stringify(functionName)}, ${userLine});\ntry {`
  );
  ms.prependRight(body.end - 1, `\n} finally { __lingua_dbg_pop(); }\n`);
}

function functionDisplayName(node: AcornNode): string {
  const id = (node as { id?: { name?: string } | null }).id;
  return id?.name ?? '<anonymous>';
}

function collectChildFunctions(node: AcornNode, queue: AcornNode[]): void {
  // Iterate the node's own properties looking for child AST nodes
  // that are function-like or contain blocks worth descending into.
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isFunctionLike(item)) queue.push(item as AcornNode);
        else if (isAcornNode(item)) collectChildFunctions(item as AcornNode, queue);
      }
    } else if (isFunctionLike(value)) {
      queue.push(value as AcornNode);
    } else if (isAcornNode(value)) {
      collectChildFunctions(value as AcornNode, queue);
    }
  }
}

function isAcornNode(value: unknown): value is AcornNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function isFunctionLike(value: unknown): boolean {
  if (!isAcornNode(value)) return false;
  return (
    value.type === 'FunctionDeclaration' ||
    value.type === 'FunctionExpression' ||
    value.type === 'ArrowFunctionExpression' ||
    value.type === 'MethodDefinition'
  );
}

/**
 * Public entry point. Returns the instrumented code and a composed
 * source map (or empty string when the input map is omitted). Throws
 * `SyntaxError` from acorn if the user's code is malformed — the
 * caller surfaces this as the same shape esbuild already returns
 * from a transpile failure.
 */
export function instrumentForDebugger(
  code: string,
  options: InstrumentOptions = {}
): InstrumentResult {
  const helperName = options.yieldHelperName ?? DEFAULT_HELPER_NAME;
  const filename = options.filename ?? 'user-code.js';

  const ast: AcornAst = Parser.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  });

  const ms = new MagicString(code, { filename });
  const recordedLines = new Set<number>();
  const translateLine = buildLineTranslator(options.inputMap);
  const awaitableTargets = collectAwaitableDebugTargets(ast);
  markAwaitableDebugFunctions(ast, ms, awaitableTargets);
  awaitKnownDebugCalls(ast, ms, awaitableTargets);
  instrumentBodies(ast, ms, helperName, recordedLines, translateLine, awaitableTargets);

  const map = ms.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  });

  const generatedCode = ms.toString();
  const mapText = map.toString();

  return {
    code: generatedCode,
    // magic-string's SourceMap.toString() inlines the map JSON; we
    // return JSON-encoded text so the caller can compose with
    // esbuild's upstream map without losing precision.
    map: mapText,
    instrumentedLines: [...recordedLines].sort((a, b) => a - b),
    sourceLineMap: buildGeneratedLineMap(generatedCode, mapText, translateLine),
  };
}

function buildGeneratedLineMap(
  generatedCode: string,
  mapText: string,
  translateLine: LineTranslator
): Record<number, number> {
  const out: Record<number, number> = {};
  let tracer: TraceMap;
  try {
    tracer = new TraceMap(mapText);
  } catch {
    return out;
  }

  const lineCount = generatedCode.split('\n').length;
  for (let line = 1; line <= lineCount; line += 1) {
    try {
      const original = originalPositionFor(tracer, { line, column: 0 });
      if (typeof original.line !== 'number' || original.line <= 0) continue;
      const userLine = translateLine(original.line);
      if (Number.isInteger(userLine) && userLine > 0) {
        out[line] = userLine;
      }
    } catch {
      // Best effort only. Unmapped generated helper lines are ignored.
    }
  }
  return out;
}
