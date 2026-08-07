/**
 * Icon-button density scale — the single source of truth shared by the
 * component layer and the `--icon-button-*` / `--icon-glyph-*` tokens in
 * index.css. `md` is the default chrome control; `sm` is for dense inline
 * spots such as a tab close affordance. The glyph size is paired with the box
 * so the ratio stays near 0.57 — pass `ICON_GLYPH[size]` to the lucide icon
 * rather than picking a number per call site.
 *
 * This lives OUTSIDE chrome.tsx on purpose. Exporting a constant from a module
 * that also exports components breaks React fast refresh for that whole file,
 * and a plain module is also the honest home for a value that tests and
 * non-component code read. tests/build/iconButtonDensity.test.ts keeps these
 * numbers in step with the CSS.
 */
export const ICON_GLYPH = { sm: 14, md: 16 } as const;

export type IconButtonSize = keyof typeof ICON_GLYPH;

export const ICON_BUTTON_BOX: Record<IconButtonSize, string> = {
  sm: 'size-6',
  md: 'size-7',
};
