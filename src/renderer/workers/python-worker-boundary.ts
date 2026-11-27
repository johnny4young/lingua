/**
 * Pyodide formats rejected Python exceptions through the original stderr file
 * descriptor. Restore that stream before the exception crosses into JS, rather
 * than capturing its traceback as user output and receiving an empty message.
 * eval_code_async is the same public evaluator used by runPythonAsync: it keeps
 * the original source, namespace, final expression and top-level await intact.
 */
export const PYTHON_EXECUTION_BOUNDARY_SOURCE = `
from ast import PyCF_ALLOW_TOP_LEVEL_AWAIT as __lingua_top_level_await
from pyodide.code import CodeRunner as __lingua_code_runner, eval_code_async as __lingua_eval_code_async

async def __lingua_execute(source, namespace, prepare=None, filename="<exec>", _eval=__lingua_eval_code_async,
                           _sys=sys, _stdout=__lingua_prev_stdout, _stderr=__lingua_prev_stderr):
    try:
        if prepare is None:
            return await _eval(source, globals=namespace, filename=filename)
        # What eval_code_async does, with a pass over the tree before it compiles.
        runner = __lingua_code_runner(source, filename="<exec>", flags=__lingua_top_level_await)
        runner.ast = prepare(runner.ast)
        return await runner.compile().run_async(namespace)
    finally:
        _sys.stdout = _stdout
        _sys.stderr = _stderr
`;

/**
 * `live` compiles through the live signal's loop pass. A `wrapper` source only calls the auto-log pass,
 * which compiles the user's tree as `<exec>`, so the wrapper is not read as a user frame.
 */
export function buildPythonBoundedExecutionSource(source: string, live = false, wrapper = false): string {
  const args = `${live ? ', __lingua_live_prepare' : ''}${wrapper ? ', filename="<lingua-auto-log>"' : ''}`;
  return `await __lingua_execute(${JSON.stringify(source)}, globals()${args})`;
}
