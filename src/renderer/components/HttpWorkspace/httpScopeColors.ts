import type { CSSProperties } from 'react';
import type { HttpEnvironmentColor, HttpVariableScope } from '../../../shared/httpEnvironment';

/** Text, wash and line colour of one hue, all theme variables (inline, so no class reaches the boot stylesheet). */
export interface HttpTint {
  readonly fg: string;
  readonly bg: string;
  readonly line: string;
}

const tone = (name: string): HttpTint => ({
  fg: `var(--color-${name}-fg)`,
  bg: `var(--color-${name}-bg)`,
  line: `var(--color-${name}-border)`,
});

export const ENVIRONMENT_TINTS: Record<HttpEnvironmentColor, HttpTint> = {
  red: tone('error'),
  orange: tone('warning'),
  green: tone('success'),
  blue: tone('info'),
  purple: {
    fg: 'var(--color-syntax-function)',
    bg: 'color-mix(in oklab, var(--color-syntax-function) 14%, transparent)',
    line: 'var(--color-syntax-function)',
  },
  gray: { fg: 'var(--color-fg-muted)', bg: 'var(--color-bg-inset)', line: 'var(--color-border-strong)' },
};

export const SCOPE_TINTS: Record<HttpVariableScope, HttpTint> = {
  collection: ENVIRONMENT_TINTS.purple,
  environment: ENVIRONMENT_TINTS.green,
  chain: ENVIRONMENT_TINTS.blue,
  request: ENVIRONMENT_TINTS.orange,
};

export const UNRESOLVED_TINT = ENVIRONMENT_TINTS.red;

/** A pill in the tint's colours. */
export const tintPill = (tint: HttpTint): CSSProperties => ({ color: tint.fg, backgroundColor: tint.bg });

/** Send in the environment's colour, darkened so its white label stays readable. */
export const tintedSend = (tint: HttpTint): CSSProperties => {
  const fill = `color-mix(in oklab, ${tint.line} 78%, black)`;
  return { backgroundColor: fill, borderColor: fill };
};
