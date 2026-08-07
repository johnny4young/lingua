import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Mechanical guard for the icon-button density scale.
 *
 * History: the workspace chrome drifted into six different icon-button sizes
 * (20x32, 24x24, 28x32, 30x32, 32x32, 36x36) and five glyph sizes (10-14px).
 * Measured in a running build, the glyph occupied 0.34-0.42 of its button,
 * against roughly 0.57 for a control that reads as deliberate. Nothing was
 * individually wrong, which is exactly why it drifted — every surface picked
 * its own numbers and no gate disagreed.
 *
 * The scale now lives in two places and this test keeps them honest:
 *   - `--icon-button-*` / `--icon-glyph-*` in `src/renderer/index.css`
 *   - `ICON_GLYPH` + the box map in `src/renderer/components/ui/iconScale.ts`
 *
 * It deliberately does NOT try to police every icon in the app. Icons that sit
 * beside text (menu rows, buttons with labels) follow the text, not this
 * scale. The subject here is the icon-ONLY control.
 */

const ROOT = resolve(__dirname, '../..');
const CSS = readFileSync(join(ROOT, 'src/renderer/index.css'), 'utf8');
const SCALE = readFileSync(join(ROOT, 'src/renderer/components/ui/iconScale.ts'), 'utf8');
const CHROME = readFileSync(join(ROOT, 'src/renderer/components/ui/chrome.tsx'), 'utf8');

/** Tailwind `size-N` is N * 0.25rem = N * 4px. */
const TAILWIND_STEP_PX = 4;

function cssVar(name: string): number {
  const match = CSS.match(new RegExp(`--${name}:\\s*(\\d+)px`, 'u'));
  expect(match, `--${name} must be declared in index.css`).not.toBeNull();
  return Number(match![1]);
}

/**
 * Yield each `<Name ...>` opening tag in full.
 *
 * A lazy regex up to the first `>` is not enough: `onClick={() => ...}`
 * contains one, so the match ends mid-props and every attribute after it —
 * including the `className` this guard exists to inspect — goes unseen. This
 * walks the tag instead, tracking brace depth and skipping string literals, so
 * only a `>` at depth zero closes it.
 */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const opener = new RegExp(`<${name}[\\s/>]`, 'gu');
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    let quote: string | null = null;
    for (let i = match.index; i < source.length; i += 1) {
      const char = source[i];
      if (quote) {
        if (char === '\\') i += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') quote = char;
      else if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      else if (char === '>' && depth === 0) {
        tags.push(source.slice(match.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

describe('icon-button density scale', () => {
  it('declares the geometry tokens outside the theme blocks', () => {
    // Geometry is not color: declaring these inside `:root, .light` would
    // leave them undefined under [data-theme='dark'], which is the default
    // theme — the pill would collapse to a zero-width button.
    const globalRoot = CSS.match(/:root\s*\{([^}]*)\}/u);
    expect(globalRoot, 'a bare `:root` block must exist for geometry tokens').not.toBeNull();
    for (const token of ['icon-button-md', 'icon-button-sm', 'icon-glyph-md', 'icon-glyph-sm']) {
      expect(globalRoot![1], `--${token} belongs in the theme-independent :root`).toContain(
        `--${token}:`
      );
    }
  });

  it('keeps every step near the 0.57 glyph-to-box ratio', () => {
    const steps: Array<[string, number, number]> = [
      ['md', cssVar('icon-button-md'), cssVar('icon-glyph-md')],
      ['sm', cssVar('icon-button-sm'), cssVar('icon-glyph-sm')],
    ];
    for (const [name, box, glyph] of steps) {
      const ratio = glyph / box;
      expect(
        ratio,
        `${name}: glyph ${glyph}px in a ${box}px box is ${ratio.toFixed(2)}`
      ).toBeGreaterThanOrEqual(0.5);
      expect(
        ratio,
        `${name}: glyph ${glyph}px in a ${box}px box is ${ratio.toFixed(2)}`
      ).toBeLessThanOrEqual(0.65);
    }
  });

  it('keeps the component box map in step with the CSS tokens', () => {
    const glyphs = SCALE.match(/ICON_GLYPH\s*=\s*\{([^}]*)\}/u);
    expect(glyphs, 'iconScale.ts must export ICON_GLYPH').not.toBeNull();
    expect(glyphs![1]).toContain(`sm: ${cssVar('icon-glyph-sm')}`);
    expect(glyphs![1]).toContain(`md: ${cssVar('icon-glyph-md')}`);

    const boxes = SCALE.match(/ICON_BUTTON_BOX[^=]*=\s*\{([^}]*)\}/u);
    expect(boxes, 'iconScale.ts must declare ICON_BUTTON_BOX').not.toBeNull();
    for (const [step, token] of [
      ['sm', 'icon-button-sm'],
      ['md', 'icon-button-md'],
    ] as const) {
      const cls = boxes![1].match(new RegExp(`${step}:\\s*'size-(\\d+)'`, 'u'));
      expect(cls, `ICON_BUTTON_BOX.${step} must use a Tailwind size-N class`).not.toBeNull();
      expect(
        Number(cls![1]) * TAILWIND_STEP_PX,
        `ICON_BUTTON_BOX.${step} must equal --${token}`
      ).toBe(cssVar(token));
    }
  });

  it('does not let IconButton default back to an ad-hoc box', () => {
    // The old default was a hardcoded `size-9` on the element itself.
    expect(CHROME).not.toMatch(/'icon-button size-\d+'/u);
    expect(CHROME).toContain('ICON_BUTTON_BOX[size]');
  });

  it('makes call sites consume the glyph token instead of retyping it', () => {
    // Exporting ICON_GLYPH is not enough on its own: while every call site
    // passed a literal `size={16}`, the map was dead code and changing
    // --icon-glyph-md moved nothing on screen while this guard stayed green.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.tsx')) continue;
        const source = readFileSync(full, 'utf8');
        let cursor = 0;
        for (const tag of openingTags(source, 'IconButton')) {
          const start = source.indexOf(tag, cursor);
          cursor = start + tag.length;
          const close = source.indexOf('</IconButton>', cursor);
          if (close === -1) continue;
          if (/size=\{\d+\}/u.test(source.slice(cursor, close))) {
            offenders.push(`${relative(ROOT, full)} (${tag.slice(0, 24)}…)`);
          }
        }
      }
    };
    walk(join(ROOT, 'src/renderer/components'));
    expect(
      [...new Set(offenders)],
      'pass ICON_GLYPH.sm / ICON_GLYPH.md to the icon instead of a numeric literal'
    ).toEqual([]);
  });

  it('keeps call sites off ad-hoc size overrides', () => {
    // A `className="size-8"` on an IconButton silently competes with the
    // token class at equal specificity, so which one wins depends on CSS
    // emission order rather than on intent. That is how the sidebar toggle
    // ended up rendering 36px while its own className asked for 28px.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.tsx')) continue;
        const source = readFileSync(full, 'utf8');
        for (const block of openingTags(source, 'IconButton')) {
          if (/className="[^"]*\b(?:size-\d+|h-\d+ w-\d+)\b/u.test(block)) {
            offenders.push(relative(ROOT, full));
          }
        }
      }
    };
    walk(join(ROOT, 'src/renderer/components'));
    expect(
      [...new Set(offenders)],
      'pass the `size` prop instead of overriding the box with a utility class'
    ).toEqual([]);
  });
});
