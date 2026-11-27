// `display(x)` and `lingua.display(x)` for Python: values join the print buffer, so they keep
// their order with print(); a progress bar keeps one buffered entry its updates edit in place.
export const PYTHON_DISPLAY_SOURCE = `
def __lingua_display_entry(payload, text):
    entry = {"text": text or " ", "method": "log", "payloads": [payload]}
    if __lingua_console_source_mapping_enabled:
        line = __lingua_caller_line()
        if line is not None:
            entry["line"] = line
    __lingua_push_print_entry(entry)
    return entry


def __lingua_display(value, as_=None):
    if as_ in ("image", "html", "chart"):
        if as_ == "image" and isinstance(value, dict):
            return __lingua_image_helper(value.get("src"), value.get("mime"))
        return {"image": __lingua_image_helper, "html": __lingua_html_helper, "chart": __lingua_chart_helper}[as_](value)
    if as_ == "text" or isinstance(value, str):
        text = value if isinstance(value, str) else str(value)
        if as_ is None and text.startswith("data:image/"):
            head = text[5:64]
            return __lingua_image_helper(text, head.split(";")[0].split(",")[0] or None)
        __lingua_display_entry({"kind": "rawText", "text": text}, text.split("\\n")[0])
        return None
    payload = __lingua_scope_value(value, 1) if as_ == "json" else __lingua_console_serialize(value, force_table=as_ == "table")
    if payload is None:
        payload = {"kind": "rawText", "text": __lingua_repr_safe(value)}
    __lingua_display_entry(payload, __lingua_repr_safe(value).split("\\n")[0])
    return None


class __LinguaProgress:
    __slots__ = ("_entry", "_run")

    def __init__(self, entry):
        self._entry = entry
        self._run = globals()["__lingua_print_run"]

    def update(self, fraction, text=None):
        payload = self._entry["payloads"][0]
        try:
            payload["value"] = min(1.0, max(0.0, float(fraction)))
        except Exception:  # noqa: BLE001
            payload["value"] = 0.0
        if text is not None:
            payload["text"] = str(text)[:80]
        # A bar already on the console is sent again; the console redraws its row. A bar kept
        # from an earlier run stays out, since its id can match a bar of this run.
        if self._entry.get("_sent") and self._run is globals()["__lingua_print_run"]:
            self._entry = {key: value for key, value in self._entry.items() if key != "_sent"}
            globals()["__lingua_push_print_entry"](self._entry)


__lingua_progress_count = [0]


def __lingua_display_progress(label=""):
    __lingua_progress_count[0] += 1
    payload = {"kind": "progress", "id": "progress-%d" % __lingua_progress_count[0], "label": str(label)[:80], "value": 0.0}
    return __LinguaProgress(__lingua_display_entry(payload, str(label)))


__lingua_display.progress = __lingua_display_progress
__lingua.display = __lingua_display
# A name the user assigned stays theirs across runs; the helpers stay reachable as lingua.display.
if "display" not in globals() or getattr(globals()["display"], "__name__", "") == "__lingua_display":
    globals()["display"] = __lingua_display
if hasattr(globals().get("lingua", __lingua), "display"):
    globals()["lingua"] = __lingua
`;
