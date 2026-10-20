/**
 * WCAG contrast for the CSS colours the renderer actually ships: oklch()
 * tokens, #hex, and Tailwind palette entries, with alpha composited over a
 * backdrop. Test-only; never import from app code.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const toSrgb = (linear: number) => {
  const v = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
};

export function oklchToRgba(l: number, c: number, hDeg: number, a = 1): Rgba {
  const h = (hDeg * Math.PI) / 180;
  const A = c * Math.cos(h);
  const B = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: toSrgb(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: toSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: toSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
    a,
  };
}

/** Parses `oklch(L C H / A)` (L as 0–1 or %), `#rgb`, `#rrggbb`. */
export function parseColor(value: string): Rgba {
  const text = value.trim();
  const oklch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/.exec(text);
  if (oklch) {
    const l = Number(oklch[1]) / (oklch[2] ? 100 : 1);
    const alpha = oklch[5] === undefined ? 1 : Number(oklch[5]) / (oklch[6] ? 100 : 1);
    return oklchToRgba(l, Number(oklch[3]), Number(oklch[4]), alpha);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const full = hex[1]!.length === 3 ? [...hex[1]!].map((ch) => ch + ch).join('') : hex[1]!;
    const n = Number.parseInt(full, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  throw new Error(`Unsupported colour: ${value}`);
}

export function over(top: Rgba, bottom: Rgba): Rgba {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

export const withAlpha = (color: Rgba, alpha: number): Rgba => ({ ...color, a: color.a * alpha });

function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const solidBg = bg.a < 1 ? over(bg, { r: 1, g: 1, b: 1, a: 1 }) : bg;
  const solidFg = fg.a < 1 ? over(fg, solidBg) : fg;
  const [hi, lo] = [luminance(solidFg), luminance(solidBg)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Custom properties declared directly in the first CSS block whose selector matches. */
export function readCssBlock(css: string, selector: RegExp): Map<string, string> {
  const match = selector.exec(css);
  if (!match) throw new Error(`Selector not found: ${selector}`);
  const start = css.indexOf('{', match.index) + 1;
  let depth = 1;
  let end = start;
  while (depth > 0 && end < css.length) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') depth -= 1;
    end += 1;
  }
  const vars = new Map<string, string>();
  for (const decl of css.slice(start, end - 1).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars.set(decl[1]!, decl[2]!.trim());
  }
  return vars;
}

/** Resolves `var(--x)` chains inside one block, falling back to `base`. */
export function resolveToken(name: string, block: Map<string, string>, base?: Map<string, string>): string {
  let value = block.get(name) ?? base?.get(name);
  for (let guard = 0; value && value.startsWith('var(') && guard < 8; guard += 1) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    value = ref ? (block.get(ref) ?? base?.get(ref)) : undefined;
  }
  if (!value) throw new Error(`Token not found: ${name}`);
  return value;
}
