/**
 * Notebook cells. Every cell compiles as `<exec>`, so a function one cell
 * defined and another cell called is told apart by code-object identity:
 * its prints and errors answer on the line of the cell that is running.
 */
export const PYTHON_CELL_SOURCE = `
def __lingua_code_tree(code, found):
    # Held by id, so no id is reused while the cell runs.
    found[id(code)] = code
    for const in code.co_consts:
        if isinstance(const, type(code)):
            __lingua_code_tree(const, found)
    return found

async def __lingua_execute_cell(source, namespace):
    global __lingua_cell_codes, __lingua_error_line
    code = __lingua_auto_log_compile(source, "cell")
    __lingua_cell_codes = __lingua_code_tree(code, {})
    try:
        pending = eval(code, namespace, namespace)
        if __lingua_inspect.iscoroutine(pending):
            await pending
    except BaseException as error:
        tb = error.__traceback__
        while tb is not None:
            if id(tb.tb_frame.f_code) in __lingua_cell_codes:
                __lingua_error_line = tb.tb_lineno
            tb = tb.tb_next
        raise
`;

export function buildPythonCellExecutionSource(code: string): string {
  return `await __lingua_execute_cell(${JSON.stringify(code)}, globals())`;
}
