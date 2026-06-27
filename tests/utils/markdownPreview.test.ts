/**
 * RL-068 — Unit tests for `renderMarkdownPreview`. Async because the
 * helper lazy-imports `marked` + `dompurify`. Covers happy-path
 * render, GFM toggle, sanitization (script tag stripped), the
 * "no remote image fetch" AC (img src cleared), and the empty /
 * tooLarge branches.
 */

import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_PREVIEW_MAX_BYTES,
  renderMarkdownPreview,
} from '../../src/renderer/utils/markdownPreview';

describe('renderMarkdownPreview', () => {
  it('renders a heading and bold span into HTML', async () => {
    const result = await renderMarkdownPreview('# Hello\n\nA **strong** word.', { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('<h1>Hello</h1>');
    expect(result.html).toContain('<strong>strong</strong>');
  });

  it('renders GFM tables when gfm=true', async () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |';
    const result = await renderMarkdownPreview(md, { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('<table>');
    expect(result.html).toContain('<th>a</th>');
  });

  it('strips <script> tags via DOMPurify', async () => {
    const md = '<script>alert(1)</script>\n\nAfter';
    const result = await renderMarkdownPreview(md, { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('alert(1)');
  });

  it('strips remote image src so no fetch is triggered (AC)', async () => {
    const md = '![alt](https://example.com/img.png)';
    const result = await renderMarkdownPreview(md, { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('<img');
    expect(result.html).toContain('alt="alt"');
    // DOMPurify drops the src attribute entirely (configured via
    // FORBID_ATTR), so the rendered img has no src at all.
    expect(result.html).not.toContain('src=');
    expect(result.html).not.toContain('https://example.com/img.png');
  });

  it('strips img src on raw HTML even when the regex pre-pass cannot disambiguate quote boundaries', async () => {
    // Adversarial-shape inline HTML the regex pre-pass would skip
    // (single-quote inside a double-quoted attribute). DOMPurify's
    // FORBID_ATTR backstop must still drop the src.
    const md = `<img src="https://example.com/x?y='1'">`;
    const result = await renderMarkdownPreview(md, { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('https://example.com');
    expect(result.html).not.toContain('src="https://');
  });

  it('strips raw HTML img srcset attributes so responsive images cannot fetch remotely', async () => {
    const md = `<img alt="x" srcset="https://example.com/a.png 1x, https://example.com/b.png 2x">`;
    const result = await renderMarkdownPreview(md, { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).not.toContain('srcset');
    expect(result.html).not.toContain('https://example.com');
  });

  it('rejects empty input with the empty error key', async () => {
    expect(await renderMarkdownPreview('', { gfm: true })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.empty',
    });
  });

  it('rejects payloads above the byte cap with the tooLarge error key', async () => {
    const huge = 'a'.repeat(MARKDOWN_PREVIEW_MAX_BYTES + 16);
    expect(await renderMarkdownPreview(huge, { gfm: true })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.tooLarge',
    });
  });

  it('measures the byte cap before trimming whitespace padding', async () => {
    const padded = `${' '.repeat(MARKDOWN_PREVIEW_MAX_BYTES + 16)}# tiny`;
    expect(await renderMarkdownPreview(padded, { gfm: true })).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.tooLarge',
    });
  });

  it('renders fenced code blocks with the language hint', async () => {
    const md = '```js\nconsole.log(1);\n```';
    const result = await renderMarkdownPreview(md, { gfm: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html).toContain('<pre>');
    expect(result.html).toContain('<code');
    expect(result.html).toContain('console.log(1);');
  });
});
