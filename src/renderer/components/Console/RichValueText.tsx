import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { formatPayloadInlineSummary } from '../../../shared/richOutput';

interface RichValueTextProps {
  payload: RichOutputPayload;
  fallbackText: string;
}

/**
 * catch-all renderer for payload kinds that don't
 * deserve their own widget today (primitives, functions, errors,
 * dates, promises, rawText, plus defensive media fallbacks).
 *
 * Prefers `formatPayloadInlineSummary` for kinds where the shared
 * formatter has a usable display string (`Date` / `Promise`),
 * otherwise reads the kind's natural shape (function name, error
 * message, primitive repr). The runner's pre-stringified
 * `fallbackText` is the absolute backstop — used when the payload's
 * own kind is text-equivalent and there is no semantic gain from
 * structured output.
 */
export function RichValueText({ payload, fallbackText }: RichValueTextProps) {
  const { t } = useTranslation();
  const display = displayFor(payload, fallbackText, t);
  return <span className="whitespace-pre-wrap text-foreground">{display}</span>;
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function displayFor(
  payload: RichOutputPayload,
  fallbackText: string,
  t: TFunc
): string {
  const summary = formatPayloadInlineSummary(payload);
  if (summary) return summary.display;
  switch (payload.kind) {
    case 'primitive':
      // A logged string prints as its text, as in any console; quotes belong to nested values.
      return payload.type === 'string' ? unquote(payload.repr) : payload.repr;
    case 'function':
      return `ƒ ${payload.name}`;
    case 'error':
      return payload.message;
    case 'rawText':
      return payload.text;
    case 'image':
      return t('console.rich.imagePlaceholder', { mime: payload.mime });
    case 'chart':
      return t('console.rich.chartPlaceholder');
    default:
      // Should be unreachable — every kind is covered above or by the
      // summary helper. Fall back to the legacy stringified text.
      return fallbackText;
  }
}

const SIMPLE_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '0': '\0' };

/**
 * `repr` is the JSON form (JS) or Python `repr` of the string, possibly
 * clamped mid-way by the runner; a clamped one keeps its truncation marker.
 */
function unquote(repr: string): string {
  try {
    const value: unknown = JSON.parse(repr);
    if (typeof value === 'string') return value;
  } catch {
    // Python quoting or a clamped repr: decode by hand below.
  }
  const quote = repr[0];
  if (quote !== '"' && quote !== "'") return repr;
  // The closing quote counts only when an even run of backslashes precedes it.
  const backslashes = repr.length - 1 - repr.slice(0, -1).replace(/\\+$/, '').length;
  const closed = repr.length > 1 && repr.endsWith(quote) && backslashes % 2 === 0;
  const body = repr.slice(1, closed ? -1 : undefined);
  return body.replace(
    /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g,
    (match, code: string) => {
      if (code.length === 1) return SIMPLE_ESCAPES[code] ?? code;
      const point = Number.parseInt(code.slice(1), 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
  );
}
