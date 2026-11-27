/**
 * Python Scratchpad auto-log instrumentation.
 *
 * Pyodide already embeds CPython's parser, so Python source is transformed via
 * `ast` inside the worker instead of a TypeScript scanner. Only module-level statements are instrumented:
 * expressions, plus assignments when a mode asks for them. Control flow,
 * function bodies, docstrings, and explicit `#=>` / `# @watch` captures keep
 * their original semantics.
 */
export const PYTHON_AUTO_LOG_HELPERS_SOURCE = `
import ast as __lingua_ast
import inspect as __lingua_inspect

def __lingua_is_explicit_capture(node):
    return (
        isinstance(node, __lingua_ast.Expr)
        and isinstance(node.value, __lingua_ast.Call)
        and isinstance(node.value.func, __lingua_ast.Name)
        and node.value.func.id == "__mc"
    )

def __lingua_auto_log_capture(line, expr, node):
    thunk = __lingua_ast.Lambda(
        args=__lingua_ast.arguments(
            posonlyargs=[], args=[], vararg=None, kwonlyargs=[],
            kw_defaults=[], kwarg=None, defaults=[]
        ),
        body=expr,
    )
    call = __lingua_ast.Call(
        func=__lingua_ast.Name(id="__mc", ctx=__lingua_ast.Load()),
        args=[__lingua_ast.Constant(value=line), thunk],
        keywords=[__lingua_ast.keyword(arg="kind", value=__lingua_ast.Constant(value="autoLog"))],
    )
    return __lingua_ast.copy_location(__lingua_ast.Expr(value=call), node)

def __lingua_answer_value(line, value):
    __mc(line, lambda: value, kind="autoLog")
    return value

def __lingua_awaits(node):
    # A lambda cannot hold an await, so awaited statements stay as written.
    return any(isinstance(child, __lingua_ast.Await) for child in __lingua_ast.walk(node))

def __lingua_assigned_value(node):
    # The value an assignment leaves in its target, read back by name.
    if isinstance(node, __lingua_ast.Assign):
        target = node.targets[0]
    elif isinstance(node, (__lingua_ast.AugAssign, __lingua_ast.AnnAssign)):
        if isinstance(node, __lingua_ast.AnnAssign) and node.value is None:
            return None
        target = node.target
    else:
        return None
    if isinstance(target, __lingua_ast.Name):
        names = [target]
    elif isinstance(target, (__lingua_ast.Tuple, __lingua_ast.List)) and all(
        isinstance(item, __lingua_ast.Name) for item in target.elts
    ):
        names = list(target.elts)
    else:
        return None
    # Generated helpers (loop guards, framework names) are not answers.
    if not names or any(name.id.startswith("__") for name in names):
        return None
    loads = [__lingua_ast.Name(id=name.id, ctx=__lingua_ast.Load()) for name in names]
    return loads[0] if len(loads) == 1 else __lingua_ast.Tuple(elts=loads, ctx=__lingua_ast.Load())

def __lingua_auto_log_compile(source, mode=None, prepare=None):
    tree = __lingua_ast.parse(source, filename="<exec>", mode="exec")
    # An explicit #=> or @watch on the line wins over its assignment answer.
    explicit_lines = {node.lineno for node in tree.body if __lingua_is_explicit_capture(node)}
    next_body = []
    for index, node in enumerate(tree.body):
        if mode is not None and node.lineno not in explicit_lines:
            assigned = __lingua_assigned_value(node)
            if assigned is not None:
                next_body.append(node)
                next_body.append(__lingua_auto_log_capture(node.lineno, assigned, node))
                continue
        is_docstring = (
            index == 0
            and isinstance(node, __lingua_ast.Expr)
            and isinstance(node.value, __lingua_ast.Constant)
            and isinstance(node.value.value, str)
        )
        if not isinstance(node, __lingua_ast.Expr) or is_docstring or __lingua_is_explicit_capture(node):
            next_body.append(node)
            continue
        if mode == "cell":
            # Notebook cells: the expression runs as written, so errors stop the cell
            # and walrus, await and dir() keep module scope; only its value is captured.
            call = __lingua_ast.Call(
                func=__lingua_ast.Name(id="__lingua_answer_value", ctx=__lingua_ast.Load()),
                args=[__lingua_ast.Constant(value=node.lineno), node.value],
                keywords=[],
            )
            next_body.append(__lingua_ast.copy_location(__lingua_ast.Expr(value=call), node))
            continue
        if __lingua_awaits(node):
            next_body.append(node)
            continue
        next_body.append(__lingua_auto_log_capture(node.lineno, node.value, node))
    tree.body = next_body
    __lingua_ast.fix_missing_locations(tree)
    tree = prepare(tree) if prepare is not None else tree
    return compile(tree, "<exec>", "exec", flags=__lingua_ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)

async def __lingua_execute_auto_log(source, namespace, mode=None, prepare=None):
    # Top-level await compiles to a coroutine; plain code runs on eval.
    pending = eval(__lingua_auto_log_compile(source, mode, prepare), namespace, namespace)
    if __lingua_inspect.iscoroutine(pending):
        await pending
`;

/** `mode` also answers module-level assignments (Scratchpad auto-runs; notebook cells run through the cell source); `live` adds the live signal's loop pass. */
export function buildPythonAutoLogExecutionSource(code: string, mode?: 'assignments', live = false): string {
  return `await __lingua_execute_auto_log(${JSON.stringify(code)}, globals()${mode ? `, ${JSON.stringify(mode)}` : ''}${live ? ', prepare=__lingua_live_prepare' : ''})`;
}
