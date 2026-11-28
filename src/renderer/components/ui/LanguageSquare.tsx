import type { CSSProperties } from 'react';
import type { Language } from '../../types/language';
import { languageBadgeTone } from '../../utils/languageMeta';
import { cn } from '../../utils/cn';

// Inline sizes keep these lazy-only values out of the boot stylesheet.
const SIZE = {
  /** Tree rows and the open-tabs list. */
  sm: { height: 16, minWidth: 16, borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-nano)', letterSpacing: '0.04em', textTransform: 'uppercase' },
  /** Start, palette, capsules and test cards. */
  md: { height: 20, minWidth: 20, borderRadius: 'var(--radius-md)', fontSize: 9.5, letterSpacing: '0.02em' },
} as const satisfies Record<string, CSSProperties>;

/** The filled language code (JS, PY, SQL) that leads a row. Decorative: the row names the language. */
export function LanguageSquare({ language, size = 'md', className }: { language: Language; size?: keyof typeof SIZE; className?: string }) {
  const tone = languageBadgeTone(language);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center font-mono font-bold leading-none', className)}
      style={{ ...SIZE[size], padding: '0 3px', background: tone.background, color: tone.foreground }}
      aria-hidden
    >
      {tone.code}
    </span>
  );
}
