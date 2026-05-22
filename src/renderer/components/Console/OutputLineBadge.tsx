import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputOrigin } from '../../../shared/richOutput';
import { useSettingsStore } from '../../stores/settingsStore';
import { trackOutputOriginClicked } from '../../utils/telemetry';

/**
 * RL-044 Sub-slice G — clickable `L<n>` chip rendered on every
 * console row whose `RichOutputPayload` carries an `origin`. Click
 * dispatches the shared `lingua-open-file` bus (reuses the Sub-slice
 * F handler in `useDefaultOpenFileConsumer`); hover dispatches the
 * new `lingua-highlight-line` bus consumed by `useEditorHighlightSync`
 * which applies a Monaco decoration class.
 *
 * Self-gates on the three Settings flags:
 *   - `outputSourceMappingEnabled` — master gate. When OFF the chip
 *     never renders.
 *   - `outputHighlightOnHoverEnabled` — hover sub-gate. When OFF the
 *     chip is still clickable but hover is a no-op.
 *   - `outputSmoothScrollOffscreenEnabled` — consumed by the
 *     editor-side handler, not here.
 *
 * Telemetry: click emits `runtime.output_origin_clicked` (Fold B
 * burst-throttled at the helper level). Hover is intentionally
 * silent — see the comment on `OUTPUT_ORIGIN_SURFACES` in
 * `src/shared/telemetry.ts`.
 *
 * Multi-tab routing (Fold D): the badge dispatches `lingua-open-file`
 * without a `tabId` field so the consumer treats it as a within-tab
 * click on the active editor model. The full multi-tab origin guard
 * (where a click on a stale entry pushes
 * `outputBadge.notice.sourceClosed`) ships with a follow-up after
 * `ConsoleEntry.tabId` is threaded through the producers — for this
 * slice the chip is single-tab; the active editor moves to the
 * captured line.
 */
export interface OutputLineBadgeProps {
  origin: RichOutputOrigin;
  language: string;
}

const HOVER_DEBOUNCE_MS = 200;

export function OutputLineBadge({ origin, language }: OutputLineBadgeProps) {
  const { t } = useTranslation();
  const masterEnabled = useSettingsStore((state) => state.outputSourceMappingEnabled);
  const hoverEnabled = useSettingsStore(
    (state) => state.outputHighlightOnHoverEnabled
  );
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

  useEffect(() => {
    if (masterEnabled && hoverEnabled) return;
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, [masterEnabled, hoverEnabled]);

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
    if (!hoverEnabled) return;
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
  }, [hoverEnabled, origin.line, origin.column]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);

  if (!masterEnabled) return null;
  if (!Number.isFinite(origin.line) || origin.line <= 0) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleMouseEnter}
      onBlur={handleMouseLeave}
      aria-label={t('console.outputBadge.ariaLabel', { line: origin.line })}
      title={t('console.outputBadge.tooltip')}
      data-testid="output-line-badge"
      className="inline-flex h-4 cursor-pointer items-center rounded-sm px-1 font-mono text-[10px] text-fg-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
    >
      L{origin.line}
    </button>
  );
}
