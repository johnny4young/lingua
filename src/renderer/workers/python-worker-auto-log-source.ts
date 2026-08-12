/**
 * Python Scratchpad auto-log instrumentation.
 *
 * Pyodide already embeds CPython's parser, so Python source is transformed via
 * `ast` inside the worker instead of duplicating a fragile indentation/string
 * scanner in TypeScript. Only module-level expression statements are wrapped;
 * declarations, control flow, function bodies, docstrings, and explicit
 * `#=>` / `# @watch` captures keep their original semantics.
 */
export const PYTHON_AUTO_LOG_HELPERS_SOURCE = `
import ast as __lingua_ast

def __lingua_is_explicit_capture(node):
    return (
        isinstance(node, __lingua_ast.Expr)
        and isinstance(node.value, __lingua_ast.Call)
        and isinstance(node.value.func, __lingua_ast.Name)
        and node.value.func.id == "__mc"
    )

def __lingua_auto_log_compile(source):
    tree = __lingua_ast.parse(source, filename="<exec>", mode="exec")
    next_body = []
    for index, node in enumerate(tree.body):
        is_docstring = (
            index == 0
            and isinstance(node, __lingua_ast.Expr)
            and isinstance(node.value, __lingua_ast.Constant)
            and isinstance(node.value.value, str)
        )
        if not isinstance(node, __lingua_ast.Expr) or is_docstring or __lingua_is_explicit_capture(node):
            next_body.append(node)
            continue
        thunk = __lingua_ast.Lambda(
            args=__lingua_ast.arguments(
                posonlyargs=[], args=[], vararg=None, kwonlyargs=[],
                kw_defaults=[], kwarg=None, defaults=[]
            ),
            body=node.value,
        )
        call = __lingua_ast.Call(
            func=__lingua_ast.Name(id="__mc", ctx=__lingua_ast.Load()),
            args=[__lingua_ast.Constant(value=node.lineno), thunk],
            keywords=[__lingua_ast.keyword(arg="kind", value=__lingua_ast.Constant(value="autoLog"))],
        )
        next_body.append(__lingua_ast.copy_location(__lingua_ast.Expr(value=call), node))
    tree.body = next_body
    __lingua_ast.fix_missing_locations(tree)
    return compile(tree, "<exec>", "exec")

def __lingua_execute_auto_log(source, namespace):
    exec(__lingua_auto_log_compile(source), namespace, namespace)
`;

export function buildPythonAutoLogExecutionSource(code: string): string {
  return `__lingua_execute_auto_log(${JSON.stringify(code)}, globals())`;
}
