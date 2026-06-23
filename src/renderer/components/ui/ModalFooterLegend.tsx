import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Kbd } from './ModalShell';

/** Keycap glyphs — literal symbols, intentionally not translated. */
const GLYPH_ARROWS = '↑↓'; // U+2191 / U+2193
const GLYPH_RETURN = '↵'; // U+21B5
const GLYPH_ESC = 'esc';

export interface ModalFooterLegendProps {
  /** ↑↓ navigate. */
  navigate?: boolean;
  /** ↵ select. */
  select?: boolean;
  /** ↵ open. */
  open?: boolean;
  /** esc close. */
  close?: boolean;
  /** Optional extra classes on the rail container. */
  className?: string;
}

interface LegendPairProps {
  glyph: ReactNode;
  label: string;
}

function LegendPair({ glyph, label }: LegendPairProps) {
  return (
    <span className="flex items-center gap-[6px] text-caption text-fg-subtle">
      <Kbd>{glyph}</Kbd>
      {label}
    </span>
  );
}

/**
 * Renders the selected legend pairs in the canonical order
 * (navigate → select → open → close). Defaults to the most common
 * combination (`navigate` + `select` + `close`) so a bare
 * `<ModalFooterLegend />` matches the shell's previous default rail.
 */
export function ModalFooterLegend({
  navigate = true,
  select = true,
  open = false,
  close = true,
  className,
}: ModalFooterLegendProps) {
  const { t } = useTranslation();

  return (
    <div className={className ?? 'flex items-center gap-[14px]'}>
      {navigate ? <LegendPair glyph={GLYPH_ARROWS} label={t('modal.legend.navigate')} /> : null}
      {select ? <LegendPair glyph={GLYPH_RETURN} label={t('modal.legend.select')} /> : null}
      {open ? <LegendPair glyph={GLYPH_RETURN} label={t('modal.legend.open')} /> : null}
      {close ? <LegendPair glyph={GLYPH_ESC} label={t('modal.legend.close')} /> : null}
    </div>
  );
}
