/**
 * RL-070 — Unit tests for `convertHtmlToJsx`. Covers attribute
 * translation, void-element self-closing, style-object literal, text
 * escaping, multi-root fragment wrap toggle, and the three error
 * branches (empty / tooLarge / parseFailure).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HTML_TO_JSX_MAX_BYTES,
  convertHtmlToJsx,
} from '../../src/renderer/utils/htmlToJsx';

describe('convertHtmlToJsx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects empty or whitespace-only input with the empty error key', () => {
    expect(convertHtmlToJsx('')).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.htmlToJsx.error.empty',
    });
    expect(convertHtmlToJsx('   \n   ')).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.htmlToJsx.error.empty',
    });
  });

  it('translates class to className and for to htmlFor', () => {
    const result = convertHtmlToJsx('<label for="name" class="lead">Name</label>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('htmlFor="name"');
    expect(result.jsx).toContain('className="lead"');
  });

  it('emits void elements as self-closing with attributes preserved', () => {
    const result = convertHtmlToJsx('<div><br><img src="x.png" alt="x"></div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('<br />');
    expect(result.jsx).toContain('<img src="x.png" alt="x" />');
  });

  it('keeps boolean HTML attributes as bare JSX props', () => {
    const result = convertHtmlToJsx('<input type="text" checked disabled>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('checked');
    expect(result.jsx).toContain('disabled');
    expect(result.jsx).not.toContain('checked=""');
  });

  it('coerces numeric-typed attributes like tabindex to expressions', () => {
    const result = convertHtmlToJsx('<div tabindex="2">ok</div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('tabIndex={2}');
  });

  it('parses inline style into a JSX object literal with camelCased properties', () => {
    const result = convertHtmlToJsx('<div style="color: red; background-color: blue">x</div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('style={{ color: "red", backgroundColor: "blue" }}');
  });

  it('preserves data-* and aria-* attributes verbatim', () => {
    const result = convertHtmlToJsx(
      '<div data-foo="bar" aria-label="x" data-something-long="y">ok</div>'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('data-foo="bar"');
    expect(result.jsx).toContain('aria-label="x"');
    expect(result.jsx).toContain('data-something-long="y"');
  });

  it('converts HTML comments into JSX comments', () => {
    const result = convertHtmlToJsx('<div><!-- hello world -->ok</div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('{/* hello world */}');
  });

  it('escapes { and } in text nodes so JSX does not treat them as interpolations', () => {
    const result = convertHtmlToJsx('<p>Use {braces} carefully.</p>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain("{'{'}");
    expect(result.jsx).toContain("{'}'}");
  });

  it('escapes decoded less-than signs in text nodes so JSX stays parseable', () => {
    const result = convertHtmlToJsx('<p>2 &lt; 3</p>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain("2 {'<'} 3");
  });

  it('camelCases event-handler attributes (onclick to onClick)', () => {
    const result = convertHtmlToJsx('<button onclick="alert(1)">ok</button>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('onClick="alert(1)"');
  });

  it('wraps multi-root input in a fragment when the default applies', () => {
    const result = convertHtmlToJsx('<p>a</p><p>b</p>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx.startsWith('<>')).toBe(true);
    expect(result.jsx.endsWith('</>')).toBe(true);
    expect(result.rootCount).toBe(2);
  });

  it('omits the fragment wrap when wrapInFragment=false even for multi-root input', () => {
    const result = convertHtmlToJsx('<p>a</p><p>b</p>', { wrapInFragment: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx.startsWith('<>')).toBe(false);
    expect(result.jsx).toContain('<p>');
  });

  it('does not wrap a single-root input even when wrapInFragment=true', () => {
    const result = convertHtmlToJsx('<p>hi</p>', { wrapInFragment: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx.startsWith('<>')).toBe(false);
    expect(result.jsx.startsWith('<p>')).toBe(true);
  });

  it('rejects payloads larger than the byte cap with the tooLarge error key', () => {
    const huge = '<div>' + 'x'.repeat(HTML_TO_JSX_MAX_BYTES + 16) + '</div>';
    expect(convertHtmlToJsx(huge)).toMatchObject({
      ok: false,
      errorKey: 'utilities.tool.htmlToJsx.error.tooLarge',
    });
  });

  it('returns parseFailure when DOMParser itself throws', () => {
    class ThrowingDOMParser {
      parseFromString() {
        throw new Error('parser unavailable');
      }
    }
    vi.stubGlobal('DOMParser', ThrowingDOMParser);

    const result = convertHtmlToJsx('<p>hi</p>');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorKey).toBe('utilities.tool.htmlToJsx.error.parseFailure');
    expect(result.message).toContain('parser unavailable');
  });

  it('preserves <script> body via a template-literal string child', () => {
    const result = convertHtmlToJsx('<div><script>var a = `hi`;</script></div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('<script>{`var a = \\`hi\\`;`}</script>');
  });

  it('escapes backslashes in raw <script> bodies so template literals preserve them', () => {
    const result = convertHtmlToJsx('<script>const path = "C:\\\\tmp"; const nl = "\\\\n";</script>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('const path = "C:\\\\\\\\tmp";');
    expect(result.jsx).toContain('const nl = "\\\\\\\\n";');
  });

  it('CSS custom properties in inline style keep their -- prefix as quoted keys', () => {
    const result = convertHtmlToJsx('<div style="--accent: red; color: var(--accent)">x</div>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('"--accent": "red"');
    expect(result.jsx).toContain('color: "var(--accent)"');
  });

  it('does not split inline style declarations on semicolons inside url() values', () => {
    const result = convertHtmlToJsx(
      '<div style="background-image: url(\'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E\'); color: red">x</div>'
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain(
      'backgroundImage: "url(\'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E\')"'
    );
    expect(result.jsx).toContain('color: "red"');
  });

  it('preserves <meta> elements that DOMParser would otherwise promote to <head>', () => {
    // DOMParser auto-hoists `<meta>` into `<head>`; the walker has to
    // read both head and body so this top-level input survives.
    const result = convertHtmlToJsx('<meta charset="utf-8"><p>hi</p>');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.jsx).toContain('<meta charSet="utf-8" />');
    expect(result.jsx).toContain('<p>');
    expect(result.rootCount).toBe(2);
  });
});
