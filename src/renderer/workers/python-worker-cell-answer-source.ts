/**
 * Notebook cell answers: the AST call that hands a value to the capture, and a
 * repr bounded before it is built, with the length of a builtin collection and
 * the digit count of an int past Python's digit limit as its size.
 */
export const PYTHON_CELL_ANSWER_SOURCE = `
def __lingua_answer_call(line, expr, node):
    call = __lingua_ast.Call(
        func=__lingua_ast.Name(id="__lingua_answer_value", ctx=__lingua_ast.Load()),
        args=[__lingua_ast.Constant(value=line), expr],
        keywords=[],
    )
    return __lingua_ast.copy_location(__lingua_ast.Expr(value=call), node)

__lingua_answer_shapes = {list: "[]", tuple: "()", set: "{}", dict: "{}"}

def __lingua_answer_repr(value, budget, seen, top=False):
    # Builds about budget characters at most, so a huge value never becomes a huge string.
    # A cut top-level collection ends in the view's cut mark instead of its closing bracket.
    kind = type(value)
    shape = __lingua_answer_shapes.get(kind)
    if shape is not None and value:
        if id(value) in seen:
            return shape[0] + "..." + shape[1]
        seen.add(id(value))
        parts = []
        used = 2
        for item in value.items() if kind is dict else value:
            if used >= budget:
                parts.append("\u2026" if top else "...")
                break
            room = max(budget - used, 16)
            if kind is dict:
                text = __lingua_answer_repr(item[0], room, seen) + ": " + __lingua_answer_repr(item[1], room, seen)
            else:
                text = __lingua_answer_repr(item, room, seen)
            parts.append(text)
            used += len(text) + 2
        seen.discard(id(value))
        if kind is tuple and len(value) == 1:
            return "(" + parts[0] + ",)"
        cut = top and parts[-1] == "\u2026"
        return shape[0] + ", ".join(parts) + ("" if cut else shape[1])
    if (kind is str or kind is bytes) and len(value) > budget:
        head = repr(value[:budget])
        return head[:-1] + "..." + head[-1]
    if kind is int:
        try:
            return repr(value)
        except ValueError:
            return __lingua_answer_int_head(value)[0]
    text = repr(value)
    return text if len(text) <= budget else text[:budget] + "..."

def __lingua_answer_int_head(value):
    # Past sys.int_max_str_digits repr raises: answer the leading digits, and the digit count as the size.
    number = abs(value)
    if number.bit_length() > 1 << 22:
        return "\u2026", None
    drop = max(int((number.bit_length() - 1) * 0.30102999566398120) - 60, 0)
    head = str(number // 10 ** drop)
    return ("-" if value < 0 else "") + head[:60] + "\u2026", len(head) + drop

def __lingua_answer_value(line, value):
    if value is None:
        return value
    size = len(value) if type(value) in __lingua_answer_shapes else None
    try:
        if type(value) is int:
            try:
                text = repr(value)
            except ValueError:
                text, size = __lingua_answer_int_head(value)
        else:
            text = __lingua_answer_repr(value, 200, set(), top=True)
    except Exception as error:  # noqa: BLE001 — a failing __repr__ answers as an error, as in Scratchpad
        __lingua_magic_results.append({"line": line, "value": str(error), "kind": "autoLog", "is_error": True})
        return value
    record = {"line": line, "value": text, "kind": "autoLog"}
    if size is not None:
        record["size"] = size
    if isinstance(value, BaseException):
        record["is_error"] = True
    __lingua_magic_results.append(record)
    return value
`;
