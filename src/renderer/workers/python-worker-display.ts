// `display(x)` and `lingua.display(x)` for Python: values join the print buffer, so they keep
// their order with print(); a progress bar keeps one buffered entry its updates edit in place.
export const PYTHON_DISPLAY_SOURCE = `
def __lingua_display_entry(payload, text):
    entry = {"text": text or " ", "method": "log", "payloads": [payload]}
    if __lingua_console_source_mapping_enabled:
        line = __lingua_caller_line()
        if line is not None:
            entry["line"] = line
    if len(__lingua_print_entries) < __lingua_print_entries_cap:
        __lingua_print_entries.append(entry)
    return entry


def __lingua_display(value, as_=None):
    if as_ in ("image", "html", "chart"):
        if as_ == "image" and isinstance(value, dict):
            return __lingua_image_helper(value.get("src"), value.get("mime"))
        return {"image": __lingua_image_helper, "html": __lingua_html_helper, "chart": __lingua_chart_helper}[as_](value)
    if as_ == "text" or isinstance(value, str):
        text = value if isinstance(value, str) else str(value)
        if as_ is None and text.startswith("data:image/"):
            return __lingua_image_helper(text)
        __lingua_display_entry({"kind": "rawText", "text": text}, text.split("\\\\n")[0])
        return None
    payload = __lingua_console_serialize(value, force_table=as_ == "table")
    if payload is None:
        payload = {"kind": "rawText", "text": __lingua_repr_safe(value)}
    __lingua_display_entry(payload, __lingua_repr_safe(value).split("\\\\n")[0])
    return None


class __LinguaProgress:
    __slots__ = ("_payload",)

    def __init__(self, payload):
        self._payload = payload

    def update(self, fraction, text=None):
        try:
            self._payload["value"] = min(1.0, max(0.0, float(fraction)))
        except Exception:  # noqa: BLE001
            self._payload["value"] = 0.0
        if text is not None:
            self._payload["text"] = str(text)[:80]


__lingua_progress_count = [0]


def __lingua_display_progress(label=""):
    __lingua_progress_count[0] += 1
    payload = {"kind": "progress", "id": "progress-%d" % __lingua_progress_count[0], "label": str(label)[:80], "value": 0.0}
    __lingua_display_entry(payload, str(label))
    return __LinguaProgress(payload)


__lingua_display.progress = __lingua_display_progress
__lingua.display = __lingua_display
globals()["display"] = __lingua_display
globals()["lingua"] = __lingua
`;

// The worker keeps its globals between runs, so a run with the flag off drops the names a flagged run defined.
export const PYTHON_DISPLAY_OFF_SOURCE = `
if getattr(globals().get("display"), "__name__", "") == "__lingua_display":
    del globals()["display"]
if hasattr(globals().get("lingua"), "display") and hasattr(globals().get("lingua"), "chart"):
    del globals()["lingua"]
`;
