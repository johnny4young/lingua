import type { PythonWorkerExecuteMessage } from './python-worker-protocol';

/** Build the Python bootstrap installed before each user-code execution. */
export function buildPythonExecutionBootstrapSource(
  message: Pick<PythonWorkerExecuteMessage, 'richConsoleEnabled' | 'sourceMappingEnabled'>
): string {
  return `
import io
import sys
import json as __lingua_json
import builtins as __lingua_builtins
import datetime as __lingua_datetime
import math as __lingua_math
__lingua_stdout = io.StringIO()
__lingua_stderr = io.StringIO()
__lingua_prev_stdout = sys.stdout
__lingua_prev_stderr = sys.stderr
sys.stdout = __lingua_stdout
sys.stderr = __lingua_stderr

# implementation — rich console payload pipeline.
# The user's namespace gets a wrapped 'print' that captures (text, [payload_per_arg])
# into __lingua_print_entries. Libraries that reach for the bare builtin via
# __lingua_builtins.print still get the unpatched function — only the user-code
# global 'print' is overridden. The serializer is pure stdlib (json + datetime +
# math) so no extra Pyodide packages are loaded.

__lingua_rich_console_enabled = ${message.richConsoleEnabled === false ? 'False' : 'True'}
# implementation baked flag mirroring the __lingua_print_entries_cap pattern.
# When False, __lingua_print and __lingua_displayhook skip the per-call
# __lingua_caller_line frame walk so a tight Python loop pays no
# inspect-frame CPU when the user has disabled the master toggle.
# Privacy-side, executeTabManually.stripConsoleOutputOrigin is defense in
# depth; this flag is the actual CPU short-circuit.
__lingua_console_source_mapping_enabled = ${message.sourceMappingEnabled === false ? 'False' : 'True'}
__lingua_print_entries = []
__lingua_print_entries_cap = 5000


class __LinguaCaptureStream(io.StringIO):
    def __init__(self, method):
        super().__init__()
        self._lingua_method = method

    def write(self, text):
        written = super().write(text)
        entries = globals().get("__lingua_print_entries")
        rich_enabled = globals().get("__lingua_rich_console_enabled")
        cap = globals().get("__lingua_print_entries_cap", 0)
        if rich_enabled and isinstance(entries, list) and text and len(entries) < cap:
            entries.append({"text": str(text), "method": self._lingua_method, "payloads": []})
        return written


# Rich mode uses the ordered print-entry stream as the console source.
# These capture streams preserve direct sys.stdout.write/sys.stderr.write
# calls as text-only entries so they are not dropped when a run also
# contains rich print() payloads. Rich print()/displayhook paths skip
# writing to these streams to avoid duplicate console rows.
__lingua_stdout = __LinguaCaptureStream("log")
__lingua_stderr = __LinguaCaptureStream("error")
sys.stdout = __lingua_stdout
sys.stderr = __lingua_stderr

_LINGUA_MAX_TOP_LEVEL = 200
_LINGUA_MAX_PER_CONTAINER = 100
_LINGUA_MAX_TABLE_ROWS = 200
_LINGUA_MAX_TABLE_COLUMNS = 16
_LINGUA_PRIMITIVE_REPR_CAP = 256


def __lingua_repr_safe(value):
    try:
        text = repr(value)
    except Exception as exc:  # noqa: BLE001 — defensive against __repr__ raising
        return "<repr error: " + type(exc).__name__ + ">"
    if len(text) > _LINGUA_PRIMITIVE_REPR_CAP:
        return text[: _LINGUA_PRIMITIVE_REPR_CAP] + "\\u2026"
    return text


def __lingua_primitive_payload(value):
    if value is None:
        return {"kind": "primitive", "type": "none", "repr": "None"}
    if isinstance(value, bool):
        return {"kind": "primitive", "type": "boolean", "repr": "True" if value else "False"}
    if isinstance(value, int):
        return {"kind": "primitive", "type": "number", "repr": __lingua_repr_safe(value)}
    if isinstance(value, float):
        if __lingua_math.isnan(value):
            return {"kind": "primitive", "type": "number", "repr": "nan"}
        if __lingua_math.isinf(value):
            return {"kind": "primitive", "type": "number", "repr": "inf" if value > 0 else "-inf"}
        return {"kind": "primitive", "type": "number", "repr": __lingua_repr_safe(value)}
    if isinstance(value, str):
        return {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value)}
    return None


def __lingua_scope_value(value, depth):
    primitive = __lingua_primitive_payload(value)
    if primitive is not None:
        return primitive
    if callable(value) and not isinstance(value, type):
        name = getattr(value, "__name__", None) or type(value).__name__
        return {"kind": "function", "name": str(name)}
    if depth <= 0:
        return {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value)}
    if isinstance(value, dict):
        preview_type = type(value).__name__ if type(value) is not dict else "dict"
        entries = []
        for idx, (key, item) in enumerate(value.items()):
            if idx >= _LINGUA_MAX_PER_CONTAINER:
                break
            entries.append({"key": __lingua_repr_safe(key), "value": __lingua_scope_value(item, depth - 1)})
        truncated = max(0, len(value) - len(entries))
        out = {"kind": "object", "previewType": preview_type, "entries": entries}
        if truncated:
            out["truncatedCount"] = truncated
        return out
    if isinstance(value, (list, tuple)):
        entries = []
        for idx, item in enumerate(value):
            if idx >= _LINGUA_MAX_PER_CONTAINER:
                break
            entries.append({"index": idx, "value": __lingua_scope_value(item, depth - 1)})
        truncated = max(0, len(value) - len(entries))
        out = {"kind": "array", "length": len(value), "entries": entries}
        if truncated:
            out["truncatedCount"] = truncated
        return out
    if isinstance(value, (set, frozenset)):
        entries = []
        for idx, item in enumerate(value):
            if idx >= _LINGUA_MAX_PER_CONTAINER:
                break
            entries.append(__lingua_scope_value(item, depth - 1))
        truncated = max(0, len(value) - len(entries))
        out = {"kind": "set", "size": len(value), "entries": entries}
        if truncated:
            out["truncatedCount"] = truncated
        return out
    if isinstance(value, __lingua_datetime.datetime):
        try:
            iso = value.isoformat()
        except Exception:  # noqa: BLE001
            iso = "Invalid Date"
        return {"kind": "date", "iso": iso}
    return None


def __lingua_dataclass_payload(value, depth):
    fields = getattr(value, "__dataclass_fields__", None)
    if not isinstance(fields, dict) or not fields:
        return None
    entries = []
    for name in fields.keys():
        try:
            child = getattr(value, name)
        except Exception as exc:  # noqa: BLE001
            child = "<attr error: " + type(exc).__name__ + ">"
        entries.append({"key": str(name), "value": __lingua_scope_value(child, depth - 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(child)}})
    return {"kind": "object", "previewType": type(value).__name__, "entries": entries}


def __lingua_detect_auto_table(value):
    if not isinstance(value, (list, tuple)) or len(value) == 0:
        return None
    column_set = []
    seen = {}
    for item in value:
        if not isinstance(item, dict):
            return None
        for key in item.keys():
            if not isinstance(key, str):
                return None
            if key not in seen:
                seen[key] = True
                column_set.append(key)
                if len(column_set) > _LINGUA_MAX_TABLE_COLUMNS:
                    return None
    if not column_set:
        return None
    slice_count = min(len(value), _LINGUA_MAX_TABLE_ROWS)
    rows = []
    for row_idx in range(slice_count):
        row = value[row_idx]
        cells = []
        for col in column_set:
            if col in row:
                cells.append(__lingua_scope_value(row[col], 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(row[col])})
            else:
                cells.append({"kind": "primitive", "type": "undefined", "repr": "None"})
        rows.append(cells)
    truncated = max(0, len(value) - slice_count)
    out = {"kind": "table", "columns": column_set, "rows": rows}
    if truncated:
        out["truncatedRowCount"] = truncated
    return out


def __lingua_force_table(value):
    auto = __lingua_detect_auto_table(value)
    if auto is not None:
        return auto
    if isinstance(value, (list, tuple)):
        slice_count = min(len(value), _LINGUA_MAX_TABLE_ROWS)
        rows = [[__lingua_scope_value(value[idx], 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value[idx])}] for idx in range(slice_count)]
        out = {"kind": "table", "columns": ["value"], "rows": rows}
        truncated = max(0, len(value) - slice_count)
        if truncated:
            out["truncatedRowCount"] = truncated
        return out
    if isinstance(value, dict):
        keys = list(value.keys())[:_LINGUA_MAX_TABLE_COLUMNS]
        if not keys:
            return {"kind": "table", "columns": [], "rows": []}
        row = [__lingua_scope_value(value[k], 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value[k])} for k in keys]
        return {"kind": "table", "columns": [str(k) for k in keys], "rows": [row]}
    return {"kind": "table", "columns": ["value"], "rows": [[__lingua_scope_value(value, 1) or {"kind": "primitive", "type": "string", "repr": __lingua_repr_safe(value)}]]}


def __lingua_console_serialize(value, force_table=False):
    # implementation note — bypass entirely when rich rendering is off; saves cycles
    # on hot Python loops by short-circuiting before the type walk.
    if not __lingua_rich_console_enabled:
        return None
    if force_table:
        return __lingua_force_table(value)
    # implementation note — Python exception → error payload.
    if isinstance(value, BaseException):
        return {"kind": "error", "message": __lingua_repr_safe(value)}
    auto_table = __lingua_detect_auto_table(value)
    if auto_table is not None:
        return auto_table
    scope = __lingua_scope_value(value, 1)
    if scope is not None:
        return scope
    dataclass_payload = __lingua_dataclass_payload(value, 1)
    if dataclass_payload is not None:
        return dataclass_payload
    return {"kind": "rawText", "text": __lingua_repr_safe(value)}


__lingua_builtins_print = __lingua_builtins.print


def __lingua_caller_line():
    # implementation follow-up — surface the user-source line number
    # so each print() entry threads through ConsoleOutput.line and
    # paints an inline pill via InlineResultWidgets (same JS behavior as
    # console.log). Walk frames upward until we exit the lingua-owned
    # helpers; user code runs in a Pyodide module compiled from a
    # string so f_lineno maps directly to the source line.
    try:
        frame = sys._getframe(1)
        while frame is not None:
            name = frame.f_code.co_name
            if name not in ("__lingua_print", "__lingua_displayhook", "__lingua_caller_line"):
                return frame.f_lineno
            frame = frame.f_back
    except Exception:  # noqa: BLE001 — best-effort
        pass
    return None


def __lingua_print(*args, sep=None, end=None, file=None, flush=False):
    target_is_console = file is None or file is sys.stdout or file is sys.stderr
    if not (__lingua_rich_console_enabled and target_is_console):
        __lingua_builtins_print(*args, sep=sep, end=end, file=file, flush=flush)
        return

    sep_actual = " " if sep is None else sep
    end_actual = "\\n" if end is None else end
    if not isinstance(sep_actual, str) or not isinstance(end_actual, str):
        # Delegate invalid sep/end handling to CPython's builtin print
        # so user-visible TypeError semantics stay stock.
        __lingua_builtins_print(*args, sep=sep, end=end, file=file, flush=flush)
        return

    text = sep_actual.join(str(arg) for arg in args) + end_actual
    if len(__lingua_print_entries) >= __lingua_print_entries_cap:
        return
    method = "error" if file is sys.stderr else "log"
    # implementation note — per-arg payload capture: each positional arg becomes its
    # own payload entry aligned with the joined text.
    payloads = []
    for arg in args:
        payload = __lingua_console_serialize(arg)
        if payload is None:
            payload = {"kind": "rawText", "text": __lingua_repr_safe(arg)}
        payloads.append(payload)
    entry = {"text": text, "method": method, "payloads": payloads}
    # implementation — skip the inspect-frame walk when the
    # master toggle is OFF. Privacy-side, the renderer strips origin
    # at executeTabManually as defense in depth; this gate is the
    # actual CPU short-circuit for tight print loops.
    if __lingua_console_source_mapping_enabled:
        line = __lingua_caller_line()
        if line is not None:
            entry["line"] = line
    __lingua_print_entries.append(entry)


# Override 'print' in the user namespace (globals) — leaves
# __lingua_builtins.print intact for any library that reaches for the
# original.
globals()["print"] = __lingua_print


def __lingua_displayhook(value):
    # implementation note — REPL-style top-level expression capture. Pyodide's
    # default displayhook prints repr() for non-None expression
    # results. We mirror that text output AND capture the value as a
    # rich payload, so a scratchpad cell ending in 'users' (no print
    # needed) renders with the same object/table chip as print(users).
    if value is None:
        return
    __lingua_builtins._ = value
    text = __lingua_repr_safe(value) + "\\n"
    if not __lingua_rich_console_enabled:
        sys.stdout.write(text)
        return
    if len(__lingua_print_entries) >= __lingua_print_entries_cap:
        return
    payload = __lingua_console_serialize(value)
    if payload is None:
        payload = {"kind": "rawText", "text": __lingua_repr_safe(value)}
    entry = {"text": text, "method": "log", "payloads": [payload]}
    # implementation — same gate as __lingua_print. The
    # displayhook fires once per top-level expression so the CPU win
    # is smaller than in tight print loops, but the consistency
    # matters: both surfaces have to honor the master toggle so the
    # privacy + perf posture is symmetric.
    if __lingua_console_source_mapping_enabled:
        line = __lingua_caller_line()
        if line is not None:
            entry["line"] = line
    __lingua_print_entries.append(entry)


sys.displayhook = __lingua_displayhook


__lingua_magic_results = []
__lingua_rich_media_directives = ("chart", "image", "html")
def __mc(line, expr_fn, directive=None):
    try:
        val = expr_fn()
        # implementation — rich-media directives need JSON-encoded
        # values because the runner side calls
        # \`payloadForRichMediaMagicDirective\` which delegates to
        # \`tryParseJsonForPayload\`. Python's \`repr(dict)\` produces
        # single-quoted strings that JSON rejects; using \`json.dumps\`
        # for these directives makes the cross-language contract
        # symmetric with the JS worker (which already JSON-stringifies).
        # Other directives keep \`repr()\` to preserve the legacy debug
        # surface for arrow comments.
        if directive in __lingua_rich_media_directives:
            try:
                value_text = __lingua_json.dumps(val)
            except Exception:  # noqa: BLE001 — non-JSON values fall back to repr
                value_text = repr(val)
        else:
            value_text = repr(val)
        record = {"line": line, "value": value_text}
        # implementation note — magic-comment '#=> table' upgrade. When the
        # directive tags 'table', also include a forced-table payload
        # so the renderer can dispatch to the rich table widget.
        if directive == "table" and __lingua_rich_console_enabled:
            try:
                record["payload"] = __lingua_console_serialize(val, force_table=True)
            except Exception:  # noqa: BLE001 — never let payload errors hide the arrow value
                pass
        __lingua_magic_results.append(record)
        return val
    except Exception as e:
        __lingua_magic_results.append({"line": line, "value": str(e)})
        return None

# implementation — \`__lingua\` namespace mirror of the JS
# \`lingua.{chart,image,html}\` bridge. Wrapping the three helpers in a
# types.SimpleNamespace keeps the user API ergonomic across languages:
#     // JS:       lingua.chart({ ... })
#     // Python:   __lingua.chart({ ... })
# Validation lives in JS (shared shared/richOutput.ts validators) so
# the rules stay single-sourced; these Python shims just forward.
import types as __lingua_types

def __lingua_chart_helper(spec):
    fn = globals().get("__lingua_emit_chart")
    if fn is None:
        return None
    fn(spec)

def __lingua_image_helper(src, mime=None):
    fn = globals().get("__lingua_emit_image")
    if fn is None:
        return None
    fn(src, mime)

def __lingua_html_helper(html):
    fn = globals().get("__lingua_emit_html")
    if fn is None:
        return None
    fn(html)

__lingua = __lingua_types.SimpleNamespace(
    chart=__lingua_chart_helper,
    image=__lingua_image_helper,
    html=__lingua_html_helper,
)


def __lingua_seed_scope(ns):
    # implementation — copy ONLY the framework helpers user code resolves by bare
    # name (the 'print' override, the '__mc' magic runner, the '__lingua'
    # namespace + its '__lingua_*' shims, and '__builtins__') into a
    # per-notebook scope dict. User variables are NEVER copied, so a
    # notebook scope stays isolated from the editor scratchpad's globals()
    # and from other notebooks. The framework names are refreshed on every
    # run (the preamble re-defines them), which is a harmless overwrite.
    for __lingua_k, __lingua_v in list(globals().items()):
        if (
            __lingua_k == "print"
            or __lingua_k == "__mc"
            or __lingua_k == "__builtins__"
            or __lingua_k.startswith("__lingua")
        ):
            ns[__lingua_k] = __lingua_v
      `;
}

/** Read and reset redirected streams after user-code execution. */
export const PYTHON_STREAM_STATE_SOURCE = `
import sys
# implementation — guarantee sys.stdout / sys.stderr / sys.displayhook
# get restored even if the JSON dump itself raises. The Pyodide worker
# is persistent, so a stranded __lingua_displayhook reference from a
# previous run would re-fire against a stale __lingua_print_entries
# list on the next execute. The cleanup runs in a finally so the
# next run always starts on the stock hooks.
try:
    _lingua_state = __lingua_json.dumps({
        "stdout": __lingua_stdout.getvalue(),
        "stderr": __lingua_stderr.getvalue(),
        "magic": __lingua_magic_results,
        "print_entries": __lingua_print_entries,
    })
except Exception as _lingua_dump_err:
    _lingua_state = __lingua_json.dumps({
        "stdout": __lingua_stdout.getvalue(),
        "stderr": __lingua_stderr.getvalue() + "\\n[lingua: dump failed: " + repr(_lingua_dump_err) + "]",
        "magic": [],
        "print_entries": [],
    })
finally:
    sys.stdout = __lingua_prev_stdout
    sys.stderr = __lingua_prev_stderr
    sys.displayhook = sys.__displayhook__
    __lingua_magic_results = []
    __lingua_print_entries = []
_lingua_state
      `;
