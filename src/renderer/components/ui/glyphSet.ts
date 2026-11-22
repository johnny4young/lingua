/** The v6 glyph set: 16 px grid, 1.5 px stroke, round joins. */
export const GLYPH_NAMES = [
  'run',
  'stop',
  'send',
  'continue',
  'stepOver',
  'stepInto',
  'stepOut',
  'runToEnd',
  'compare',
  'refresh',
  'history',
  'table',
  'database',
  'globe',
  'notebook',
  'utilities',
  'capsule',
  'folder',
  'search',
  'export',
  'filter',
  'key',
  'ai',
  'theme',
] as const;

export type GlyphName = (typeof GLYPH_NAMES)[number];

export const GLYPH_STROKE = 1.5;

/** A labelled glyph is an image; an unlabelled one is decorative. */
export function glyphA11y(label?: string) {
  return label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
}
