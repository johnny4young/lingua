/**
 * Pyodide formats rejected Python exceptions through the original stderr file
 * descriptor. Restore that stream before the exception crosses into JS, rather
 * than capturing its traceback as user output and receiving an empty message.
 * eval_code_async is the same public evaluator used by runPythonAsync: it keeps
 * the original source, namespace, final expression and top-level await intact.
 */
export const PYTHON_EXECUTION_BOUNDARY_SOURCE = `
from pyodide.code import eval_code_async as __lingua_eval_code_async

async def __lingua_execute(source, namespace, _eval=__lingua_eval_code_async,
                           _sys=sys, _stdout=__lingua_prev_stdout, _stderr=__lingua_prev_stderr):
    try:
        return await _eval(source, globals=namespace)
    finally:
        _sys.stdout = _stdout
        _sys.stderr = _stderr
`;

export function buildPythonBoundedExecutionSource(source: string): string {
  return `await __lingua_execute(${JSON.stringify(source)}, globals())`;
}
