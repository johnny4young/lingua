import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputPayload } from '../../../shared/richOutput';
import { formatPayloadInlineSummary } from '../../../shared/richOutput';
import { trackEvent } from '../../utils/telemetry';
import {
  typeIcon,
  richKindBucket,
  payloadHasRichSurface,
} from './richConsoleFormat';
import { ConsoleEntryPopover } from './ConsoleEntryPopover';
import { RichValueText } from './RichValueText';
import { RichValueObject } from './RichValueObject';
import { RichValueArray } from './RichValueArray';
import { RichValueMapSet } from './RichValueMapSet';
import { RichValueTable } from './RichValueTable';
import { RichValueImage } from './RichValueImage';
import { RichValueHtml } from './RichValueHtml';
import { RichValueError } from './RichValueError';

interface ConsoleEntryRendererProps {
  payloads: RichOutputPayload[];
  fallbackText: string;
  /** Source language for the entry. Forwarded to clickable-stack telemetry. */
  language?: string;
}

const reportedPayloadRows = new WeakSet<RichOutputPayload[]>();

/**
 * RL-044 Slice 1B — dispatch wrapper that paints a row of rich
 * payloads. Click on any payload-bearing chip opens
 * `<ConsoleEntryPopover>` with the Preview / Raw JSON tabs.
 *
 * Telemetry: each entry fires `runtime.console_rich_rendered` at most
 * once per first-render with the closed-enum kind bucket.
 */
export function ConsoleEntryRenderer({
  payloads,
  fallbackText,
  language,
}: ConsoleEntryRendererProps) {
  const { t } = useTranslation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Fire-and-forget adoption telemetry. Module-level WeakSet state is
  // intentional here: React strict-mode can remount the component with
  // the same stored payload array, and a ref would be reset on that
  // second mount.
  useEffect(() => {
    if (reportedPayloadRows.has(payloads)) return;
    reportedPayloadRows.add(payloads);
    for (const payload of payloads) {
      void trackEvent('runtime.console_rich_rendered', {
        kind: richKindBucket(payload),
      });
    }
  }, [payloads]);

  const handleClose = useCallback(() => setOpenIndex(null), []);

  // Empty payload array → fall back entirely.
  if (payloads.length === 0) {
    return <span className="whitespace-pre-wrap">{fallbackText}</span>;
  }

  const popoverPayload =
    openIndex !== null && payloads[openIndex] !== undefined
      ? payloads[openIndex]
      : null;

  return (
    <>
      <span className="inline-flex flex-wrap items-center gap-1">
        {payloads.map((payload, index) => {
          const canOpen = payloadHasRichSurface(payload);
          // The chip below only renders when `canOpen` is true, so we
          // never need a fallback `undefined` branch — `summary.display`
          // wins when present, otherwise the localized "Open details"
          // string covers the chip's tooltip.
          const summary = canOpen ? formatPayloadInlineSummary(payload) : null;
          const labelTitle = summary?.display ?? t('console.rich.openDetails');
          return (
            <span key={index} className="inline-flex items-center gap-1">
              <RichValueDispatch
                payload={payload}
                fallbackText={fallbackText}
                language={language}
              />
              {canOpen && (
                <button
                  type="button"
                  onClick={() => setOpenIndex(index)}
                  aria-label={t('console.rich.openDetails')}
                  title={labelTitle}
                  data-testid="console-rich-open-details"
                  className="rounded-md border border-transparent px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle hover:border-border/60 hover:text-foreground"
                >
                  {typeIcon(payload)}
                </button>
              )}
            </span>
          );
        })}
      </span>
      {popoverPayload !== null && (
        <ConsoleEntryPopover payload={popoverPayload} onClose={handleClose} />
      )}
    </>
  );
}

/**
 * Compact-preview dispatch — one of the five RichValue* components.
 * `text` is the catch-all for primitive / function / error / rawText
 * payloads so the console never paints an empty inline cell.
 */
function RichValueDispatch({
  payload,
  fallbackText,
  language,
}: {
  payload: RichOutputPayload;
  fallbackText: string;
  language?: string;
}) {
  switch (payload.kind) {
    case 'table':
      return <RichValueTable payload={payload} />;
    case 'map':
    case 'set':
      return <RichValueMapSet payload={payload} />;
    case 'object':
      return <RichValueObject payload={payload} />;
    case 'array':
      return <RichValueArray payload={payload} />;
    case 'image':
      return <RichValueImage payload={payload} fallbackText={fallbackText} />;
    case 'html':
      return <RichValueHtml payload={payload} />;
    case 'error':
      return (
        <RichValueError
          payload={payload}
          language={language}
          fallbackText={fallbackText}
        />
      );
    case 'primitive':
    case 'function':
    case 'date':
    case 'promise':
    case 'rawText':
    case 'chart':
      return <RichValueText payload={payload} fallbackText={fallbackText} />;
  }
}
