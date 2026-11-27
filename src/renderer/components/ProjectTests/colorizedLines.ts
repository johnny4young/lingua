import { useEffect, useState } from 'react';
import type * as monacoTypes from 'monaco-editor';

export interface ColorToken {
  className: string;
  text: string;
}

const TOKEN_CLASS = /^mtk\d+(?: mtk[ibus])*$/u;

/** Monaco's colorized HTML, one entry per line, as class and text pairs, so callers render text and never markup. */
function linesFromColorizedHtml(html: string): ColorToken[][] {
  return html.split(/<br\s*\/?>/u).map(line =>
    [...new DOMParser().parseFromString(line, 'text/html').body.querySelectorAll('span')]
      .filter(span => span.childElementCount === 0 && TOKEN_CLASS.test(span.className))
      .map(span => ({ className: span.className, text: (span.textContent ?? '').replace(/\u00a0/gu, ' ') }))
  );
}

/**
 * Each line of each block colored by the editor's tokenizer for `languageId`,
 * in the theme's token colors and in block order. A block is tokenized as a
 * whole, so a string or comment can span its lines. Null until ready or when
 * it fails, so callers show plain text.
 */
export function useColorizedLines(
  monaco: typeof monacoTypes | null,
  languageId: string,
  blocks: readonly (readonly string[])[],
  tabSize: number
): ColorToken[][] | null {
  const key = `${languageId}\u0000${tabSize}\u0000${blocks.map(block => block.join('\n')).join('\u0001')}`;
  const [colored, setColored] = useState<{ key: string; lines: ColorToken[][] } | null>(null);

  useEffect(() => {
    const filled = blocks.filter(block => block.length > 0);
    if (!monaco || languageId === 'plaintext' || filled.length === 0) return;
    let active = true;
    Promise.all(filled.map(block => monaco.editor.colorize(block.join('\n'), languageId, { tabSize })))
      .then(html => {
        const lines = html.flatMap((block, index) => linesFromColorizedHtml(block).slice(0, filled[index]!.length));
        if (active && lines.length === filled.flat().length) setColored({ key, lines });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // `key` stands for `languageId`, `tabSize` and `blocks`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, key]);

  return colored?.key === key ? colored.lines : null;
}
