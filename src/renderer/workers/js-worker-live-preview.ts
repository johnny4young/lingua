import { LIVE_RUN_MAX_BINDING_ITEMS, LIVE_RUN_MAX_BINDING_TEXT } from '../../shared/liveRun';

/** Primitives, and small arrays and plain objects of primitives, as JSON; anything else sends no value. */
function previewOf(value: unknown): string | undefined {
  let text: string | undefined;
  switch (typeof value) {
    case 'string':
      // Sized first: a long string is never serialized only to be dropped.
      if (value.length > LIVE_RUN_MAX_BINDING_TEXT) return undefined;
      text = JSON.stringify(value);
      break;
    case 'number':
    case 'boolean':
    case 'bigint':
      text = String(value);
      break;
    case 'undefined':
      text = 'undefined';
      break;
    case 'object': {
      if (value === null) {
        text = 'null';
        break;
      }
      const plain = Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
      if (!plain || (Array.isArray(value) ? value.length : Object.keys(value).length) > LIVE_RUN_MAX_BINDING_ITEMS) return undefined;
      // Own data properties holding short primitives only: a getter or a nested toJSON would run user code from the tracker.
      const entries = Object.getOwnPropertyDescriptors(value);
      let size = 0;
      for (const key of Object.keys(entries)) {
        const entry = entries[key]!;
        if (!('value' in entry) || (entry.value !== null && typeof entry.value === 'object') || typeof entry.value === 'function') return undefined;
        size += typeof entry.value === 'string' ? entry.value.length : 1;
      }
      if (size > LIVE_RUN_MAX_BINDING_TEXT) return undefined;
      try {
        text = JSON.stringify(value);
      } catch {
        return undefined;
      }
      break;
    }
    default:
      return undefined;
  }
  return text !== undefined && text.length <= LIVE_RUN_MAX_BINDING_TEXT ? text : undefined;
}

/** The slot's value as preview text; a slot that throws (its binding not initialised yet) sends none. */
export function readPreview(read: () => unknown): string | undefined {
  try {
    return previewOf(read());
  } catch {
    return undefined;
  }
}
