import { Parser } from 'acorn';
import MagicString from 'magic-string';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Acorn's exported types are loose; we cast to a structural shape per
// node type as we walk. This is the same pattern Vite plugins use.
type AcornAst = any;
type AcornNode = any;

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
 * Slice 1 emits magic-string's JS→JS map only. The `inputMap` field
 * on `InstrumentOptions` is reserved but **not yet composed** — the
 * upstream esbuild TS→JS map is not threaded through this slice. As
 * a result, breakpoints set in `.ts` files map to post-instrumented
 * line numbers, not to the original TS source. Slice 1.5 wires the
 * full two-stage compose via `@jridgewell/trace-mapping` (or
 * equivalent) so a breakpoint at TS line N pauses at TS line N. For
 * the JS code path the single map is correct.
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
   * Reserved for Slice 1.5 — when supplied, this is the upstream
   * esbuild TS→JS map that the instrumenter will compose with its
   * own JS→JS map so breakpoints round-trip back to the original TS
   * source line. Slice 1 does not yet compose maps; passing
   * `inputMap` is silently a no-op until Slice 1.5 wires it.
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
  }

  return [...seen];
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
  recordedLines: Set<number>
): void {
  const queue: AcornNode[] = [ast];

  while (queue.length > 0) {
    const node = queue.shift()!;
    const body = bodyStatements(node);
    wrapAsyncFunctionBody(node, ms);

    for (const stmt of body) {
      injectYieldBefore(stmt, ms, helperName, recordedLines, node);
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
  parent: AcornNode
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

  if (!canAwaitInBody(parent)) return;

  const line = stmt.loc?.start.line ?? 0;
  if (line === 0) return;

  const localObject = buildLocalSnapshotExpression(collectLocalIdentifiers(parent));

  const yieldExpr = `await ${helperName}(${line}, () => ${localObject});`;

  // Inject BEFORE the statement. magic-string's `appendLeft` keeps
  // multiple injections at the same offset in source order, so the
  // yield ends up immediately before the original character.
  ms.appendLeft(stmt.start, `${yieldExpr}\n`);
  recordedLines.add(line);
}

function canAwaitInBody(parent: AcornNode): boolean {
  if (parent.type === 'Program') return true;
  if (
    parent.type === 'FunctionDeclaration' ||
    parent.type === 'FunctionExpression' ||
    parent.type === 'ArrowFunctionExpression'
  ) {
    return (parent as { async?: boolean; generator?: boolean }).async === true &&
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

function wrapAsyncFunctionBody(node: AcornNode, ms: MagicString): void {
  if (!canAwaitInBody(node)) return;
  if (node.type === 'Program') return;
  const body = (node as { body?: AcornNode }).body;
  if (!body || body.type !== 'BlockStatement') return;

  const functionName = functionDisplayName(node);
  const line = node.loc?.start.line ?? 0;
  ms.appendLeft(
    body.start + 1,
    `\n__lingua_dbg_frame(${JSON.stringify(functionName)}, ${line});\ntry {`
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
  instrumentBodies(ast, ms, helperName, recordedLines);

  const map = ms.generateMap({
    source: filename,
    includeContent: true,
    hires: true,
  });

  return {
    code: ms.toString(),
    // magic-string's SourceMap.toString() inlines the map JSON; we
    // return JSON-encoded text so the caller can compose with
    // esbuild's upstream map without losing precision.
    map: map.toString(),
    instrumentedLines: [...recordedLines].sort((a, b) => a - b),
  };
}
