import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { formatPayloadInlineSummary } from '../../../shared/richOutput';

interface RichValueTextProps {
  payload: RichOutputPayload;
  fallbackText: string;
}

/**
 * implementation — catch-all renderer for payload kinds that don't
 * deserve their own widget today (primitives, functions, errors,
 * dates, promises, rawText, plus defensive media fallbacks).
 *
 * Prefers `formatPayloadInlineSummary` for kinds where the shared
 * implementation formatter has a usable display string (`Date` / `Promise`),
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
      return payload.repr;
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
