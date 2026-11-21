import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RichOutputOrigin } from '../../../shared/richOutput';
import { trackOutputOriginClicked } from '../../utils/telemetry';
import { emitCommand } from '../../stores/commandBus';

/**
 * Source line in the console tape gutter. Click opens the line through the
 * shared `file.open` command, hover highlights it in the editor; the row's
 * `@origin off` check decides whether it renders at all. Click telemetry is
 * burst-throttled; hover is silent.
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
      className="rounded font-mono tabular-nums text-fg-subtle transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {origin.line}
    </button>
  );
}
