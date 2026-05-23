import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputOrigin } from '../../../shared/richOutput';
import { trackOutputOriginClicked } from '../../utils/telemetry';

/**
 * RL-044 Sub-slice G — clickable `L<n>` chip rendered on every
 * console row whose `RichOutputPayload` carries an `origin`. Click
 * dispatches the shared `lingua-open-file` bus (reuses the Sub-slice
 * F handler in `useDefaultOpenFileConsumer`); hover dispatches the
 * new `lingua-highlight-line` bus consumed by `useEditorHighlightSync`
 * which applies a Monaco decoration class.
 *
 * Slice 2 — the master/hover Settings toggles are gone; output→source
 * linking is a baseline affordance. The per-tab `// @origin off`
 * directive remains as the user-controlled escape hatch (the parent
 * `<ConsoleEntryRenderer>` suppresses the chip when the buffer
 * carries the directive).
 *
 * Telemetry: click emits `runtime.output_origin_clicked` (Fold B
 * burst-throttled at the helper level). Hover is intentionally
 * silent — see the comment on `OUTPUT_ORIGIN_SURFACES` in
 * `src/shared/telemetry.ts`.
 */
export interface OutputLineBadgeProps {
  origin: RichOutputOrigin;
  language: string;
}

const HOVER_DEBOUNCE_MS = 200;

export function OutputLineBadge({ origin, language }: OutputLineBadgeProps) {
  const { t } = useTranslation();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear any pending hover broadcast when the chip unmounts so a
    // late timer does not flash a line on the next mount.
    return () => {
      if (hoverTimer.current) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
    };
  }, []);

  const handleClick = useCallback(() => {
    const detail = {
      file: '',
      line: origin.line,
      column: origin.column,
    };
    window.dispatchEvent(
      new CustomEvent('lingua-open-file', { detail, cancelable: true })
    );
    trackOutputOriginClicked(language, 'badge');
  }, [origin.line, origin.column, language]);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('lingua-highlight-line', {
          detail: {
            line: origin.line,
            column: origin.column,
            durationMs: 1500,
          },
        })
      );
    }, HOVER_DEBOUNCE_MS);
  }, [origin.line, origin.column]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  if (!Number.isFinite(origin.line) || origin.line <= 0) return null;

  return (
    <button
      type="button"
      data-testid="output-line-badge"
      data-line={origin.line}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      title={t('console.outputBadge.tooltip')}
      aria-label={t('console.outputBadge.ariaLabel', { line: origin.line })}
      className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-mono font-medium leading-[14px] text-fg-subtle hover:text-foreground hover:bg-surface-strong/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      L{origin.line}
    </button>
  );
}
