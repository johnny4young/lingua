import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputOrigin } from '../../../shared/richOutput';
import { trackOutputOriginClicked } from '../../utils/telemetry';
import { emitCommand } from '../../stores/commandBus';

/**
 * implementation — clickable `L<n>` chip rendered on every
 * console row whose `RichOutputPayload` carries an `origin`. Click
 * emits the shared `file.open` command (reuses the implementation
 * F handler in `useDefaultOpenFileConsumer`); hover emits the
 * new `editor.highlightLine` command consumed by `useEditorHighlightSync`
 * which applies a Monaco decoration class.
 *
 * implementation — the master/hover Settings toggles are gone; output→source
 * linking is a baseline affordance. The per-tab `// @origin off`
 * directive remains as the user-controlled escape hatch (the parent
 * `<ConsoleEntryRenderer>` suppresses the chip when the buffer
 * carries the directive).
 *
 * Telemetry: click emits `runtime.output_origin_clicked` (implementation note
 * burst-throttled at the helper level). Hover is intentionally
 * silent — see the comment on `OUTPUT_ORIGIN_SURFACES` in
 * `src/shared/telemetry.ts`.
 *
 * FASE 2b (MOV.05) — deliberately NOT migrated to `<StatusBadge>`.
 * StatusBadge is a non-interactive uppercase status chip; this is an
 * interactive mono navigation affordance (click + hover bus commands +
 * telemetry). It already speaks the Signal-Slate mono-meta language
 * (`font-mono`, `text-fg-subtle`, `rounded`, `focus-visible:outline-accent`),
 * so no token change is needed.
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
    // Clear any pending hover command when the chip unmounts so a
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
    emitCommand('file.open', detail);
    trackOutputOriginClicked(language, 'badge');
  }, [origin.line, origin.column, language]);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      emitCommand('editor.highlightLine', {
        line: origin.line,
        column: origin.column,
        durationMs: 1500,
      });
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
      className="inline-flex items-center rounded px-1.5 py-0 text-eyebrow font-mono font-medium leading-[14px] text-fg-subtle hover:text-foreground hover:bg-surface-strong/70 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      L{origin.line}
    </button>
  );
}
