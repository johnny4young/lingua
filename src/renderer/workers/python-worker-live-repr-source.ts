import { LIVE_RUN_MAX_BINDING_ITEMS, LIVE_RUN_MAX_BINDING_TEXT } from '../../shared/liveRun';

/** The loop variable's repr for the live sampler; sized before `repr` builds any text. */
export const PYTHON_LIVE_REPR_SOURCE = `
__lingua_live_scalars = (int, float, complex, bool, str, bytes, type(None))
__lingua_live_containers = (list, tuple, dict, set, frozenset)


def __lingua_live_repr(value):
    # Builtin values only, so a sample never runs a user __repr__; a container holds scalars and stays short.
    kind = type(value)
    if kind in __lingua_live_containers:
        items = value.items() if kind is dict else value
        if len(value) > ${LIVE_RUN_MAX_BINDING_ITEMS}:
            return None
        size = 0
        for item in items:
            for part in (item if kind is dict else (item,)):
                if type(part) not in __lingua_live_scalars:
                    return None
                size += len(part) if type(part) in (str, bytes) else 1
        if size > ${LIVE_RUN_MAX_BINDING_TEXT}:
            return None
    elif kind not in __lingua_live_scalars or (kind in (str, bytes) and len(value) > ${LIVE_RUN_MAX_BINDING_TEXT}):
        return None
    text = repr(value)
    return text if len(text) <= ${LIVE_RUN_MAX_BINDING_TEXT} else None
`;
