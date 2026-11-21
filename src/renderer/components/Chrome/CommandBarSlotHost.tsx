import { useCallback } from 'react';
import { useCommandBarSlotStore, type CommandBarSlotKind } from '../../stores/commandBarSlotStore';
import type { Language } from '../../types/language';
import { languageBadgeTone } from '../../utils/languageMeta';

// Kept apart from CommandBarSlot so the bar's boot chunk carries only the hosts.

/** Where the bar receives a slot. `display: contents` keeps the children in the bar's flex row. */
export function CommandBarSlotHost({ slot }: { slot: CommandBarSlotKind }) {
  const setHost = useCommandBarSlotStore((state) => state.setHost);
  const clearHost = useCommandBarSlotStore((state) => state.clearHost);
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      setHost(slot, element);
      return () => clearHost(slot, element);
    },
    [slot, setHost, clearHost]
  );
  return <div ref={ref} data-testid={`command-bar-${slot}`} className="contents" />;
}

/** The square language/surface code (JS, PY, SQL, HTTP) every chip leads with. */
export function SurfaceBadge({ language, size = 'pill' }: { language: Language; size?: 'pill' | 'menu' }) {
  const meta = languageBadgeTone(language);
  const dimension = size === 'menu' ? 22 : 18;
  // Four-glyph codes (HTTP) tighten the type instead of widening the square.
  const isLongCode = meta.code.length >= 4;
  const baseFont = size === 'menu' ? 9.5 : 9;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center font-mono font-bold"
      style={{
        width: dimension,
        height: dimension,
        borderRadius: size === 'menu' ? 5 : 4,
        fontSize: isLongCode ? baseFont - 1.5 : baseFont,
        letterSpacing: isLongCode ? '0' : '0.04em',
        background: meta.background,
        color: meta.foreground,
      }}
      aria-hidden
    >
      {meta.code}
    </span>
  );
}
