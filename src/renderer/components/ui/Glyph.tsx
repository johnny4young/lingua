import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDownToDot,
  ArrowRight,
  ArrowUpFromDot,
  Box,
  Clock,
  Database,
  Folder,
  Funnel,
  Globe,
  PanelsTopLeft,
  RedoDot,
  RefreshCw,
  Search,
  SkipForward,
  StepForward,
  Sun,
  Upload,
  Wrench,
  Zap,
} from 'lucide-react';
import { GLYPH_STROKE, glyphA11y, type GlyphName } from './glyphSet';
import { ICON_GLYPH } from './iconScale';

/** Board-drawn glyphs where lucide's shape differs. */
const CUSTOM = {
  run: <path d="M5 3.2v9.6L12.6 8z" fill="currentColor" stroke="none" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />,
  compare: <path d="M5 3v7M5 13v0M11 13V6M11 3v0M2.5 6.5 5 3l2.5 3.5M8.5 9.5 11 13l2.5-3.5" />,
  notebook: (
    <>
      <rect x="3.5" y="2.5" width="9" height="11" rx="1.5" />
      <path d="M6 6h4M6 8.5h4M6 11h2" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="2.5" />
      <path d="m7.5 8.5 5.5-5.5M11 5l1.5 1.5" />
    </>
  ),
} satisfies Partial<Record<GlyphName, ReactNode>>;

const LUCIDE: Record<Exclude<GlyphName, keyof typeof CUSTOM>, LucideIcon> = {
  send: ArrowRight,
  continue: StepForward,
  stepOver: RedoDot,
  stepInto: ArrowDownToDot,
  stepOut: ArrowUpFromDot,
  runToEnd: SkipForward,
  refresh: RefreshCw,
  history: Clock,
  table: PanelsTopLeft,
  database: Database,
  globe: Globe,
  utilities: Wrench,
  capsule: Box,
  folder: Folder,
  search: Search,
  export: Upload,
  filter: Funnel,
  ai: Zap,
  theme: Sun,
};

/** Crops the 16 px grid's margin so board glyphs sit at lucide's optical size. */
const CUSTOM_VIEWBOX = 13;

export interface GlyphProps {
  name: GlyphName;
  /** Pixel size; pass `ICON_GLYPH[size]` inside icon-only controls. */
  size?: number;
  /** Accessible name. Without it the glyph is decorative and hidden. */
  label?: string;
  className?: string;
}

/** One icon component for the glyph set, drawn by lucide wherever its shape matches the board. */
export function Glyph({ name, size = ICON_GLYPH.md, label, className }: GlyphProps) {
  const a11y = glyphA11y(label);
  if (name in CUSTOM) {
    return (
      <svg
        {...a11y}
        data-glyph={name}
        className={className}
        width={size}
        height={size}
        viewBox={`1.5 1.5 ${CUSTOM_VIEWBOX} ${CUSTOM_VIEWBOX}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={(GLYPH_STROKE * CUSTOM_VIEWBOX) / size}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {CUSTOM[name as keyof typeof CUSTOM]}
      </svg>
    );
  }
  const Icon = LUCIDE[name as keyof typeof LUCIDE];
  return (
    <Icon
      {...a11y}
      data-glyph={name}
      className={className}
      size={size}
      strokeWidth={GLYPH_STROKE}
      absoluteStrokeWidth
    />
  );
}
