/**
 * implementation note — `color-convert` adapter.
 *
 * Parses a CSS color in hex (#rgb / #rrggbb / #rrggbbaa) or
 * rgb()/rgba() notation and emits hex, rgb(), and hsl() lines. Pure
 * shared reimplementation (the renderer's `analyzeColor` is panel-only
 * and richer); named colors are out of scope (a large table) and
 * resolve to `invalid-input`. Unparseable input → `invalid-input`.
 */

import type { UtilityAdapter } from './types';

/** No options. */
export type ColorConvertOptions = Record<string, never>;

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseEmptyOptions(raw: unknown): ColorConvertOptions | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {};
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Parse hex / rgb() / rgba() into 0-255 channels + 0-1 alpha. */
function parseColor(input: string): Rgb | null {
  const trimmed = input.trim().toLowerCase();
  const hexMatch = /^#([0-9a-f]{3,8})$/u.exec(trimmed);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0]! + hex[0]!, 16);
      const g = parseInt(hex[1]! + hex[1]!, 16);
      const b = parseInt(hex[2]! + hex[2]!, 16);
      const a = hex.length === 4 ? parseInt(hex[3]! + hex[3]!, 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }
  const rgbMatch =
    /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/u.exec(
      trimmed
    );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (r > 255 || g > 255 || b > 255) return null;
    return { r, g, b, a: 1 };
  }
  const rgbaMatch =
    /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([+-]?(?:\d+|\d*\.\d+))\s*\)$/u.exec(
      trimmed
    );
  if (rgbaMatch) {
    const r = Number(rgbaMatch[1]);
    const g = Number(rgbaMatch[2]);
    const b = Number(rgbaMatch[3]);
    const a = Number(rgbaMatch[4]);
    if (
      r > 255 ||
      g > 255 ||
      b > 255 ||
      !Number.isFinite(a) ||
      a < 0 ||
      a > 1
    ) {
      return null;
    }
    return { r, g, b, a };
  }
  return null;
}

function toHex({ r, g, b, a }: Rgb): string {
  const pair = (value: number) => clampByte(value).toString(16).padStart(2, '0');
  const base = `#${pair(r)}${pair(g)}${pair(b)}`;
  return a < 1 ? `${base}${pair(a * 255)}` : base;
}

/** RGB (0-255) → HSL with H in degrees, S/L in percent. */
function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export const colorConvertAdapter: UtilityAdapter<ColorConvertOptions> = {
  id: 'color-convert',
  titleKey: 'utilityPipeline.adapter.colorConvert.title',
  descriptionKey: 'utilityPipeline.adapter.colorConvert.description',
  inputKind: 'text',
  outputKind: 'text',
  optionsSchema: [],
  defaultOptions: () => ({}),
  parseOptions: parseEmptyOptions,
  run: async (input) => {
    const rgb = parseColor(input);
    if (rgb === null) {
      return {
        ok: false,
        reason: 'invalid-input',
        detail: 'expected a hex or rgb()/rgba() color',
      };
    }
    const { h, s, l } = toHsl(rgb);
    const rgbLine =
      rgb.a < 1
        ? `rgba(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)}, ${Number(rgb.a.toFixed(3))})`
        : `rgb(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)})`;
    const value = [`HEX: ${toHex(rgb)}`, `RGB: ${rgbLine}`, `HSL: hsl(${h}, ${s}%, ${l}%)`].join(
      '\n'
    );
    return { ok: true, value };
  },
};
