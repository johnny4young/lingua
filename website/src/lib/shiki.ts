/**
 * Singleton Shiki highlighter for the hero code panel.
 *
 * One bundle for all five languages, dark theme tuned to match the site
 * surface. Used at build time only — no runtime JS for highlighting.
 */

import { createHighlighter, type Highlighter } from 'shiki';

let promise: Promise<Highlighter> | null = null;

export const HERO_LANGS = ['javascript', 'typescript', 'python', 'go', 'rust'] as const;
export type HeroLang = (typeof HERO_LANGS)[number];

export const HERO_THEME = 'github-dark-default';

export async function getHighlighter(): Promise<Highlighter> {
  if (!promise) {
    promise = createHighlighter({
      themes: [HERO_THEME],
      langs: [...HERO_LANGS],
    });
  }
  return promise;
}

export async function highlight(code: string, lang: HeroLang): Promise<string> {
  const hi = await getHighlighter();
  return hi.codeToHtml(code, {
    lang,
    theme: HERO_THEME,
    transformers: [
      {
        pre(node) {
          // Strip shiki's inline background — we paint our own surface
          const style = node.properties.style;
          if (typeof style === 'string') {
            node.properties.style = style.replace(/background-color:[^;]+;?/g, '');
          }
          node.properties.class = `${node.properties.class ?? ''} hero-code`.trim();
        },
      },
    ],
  });
}
