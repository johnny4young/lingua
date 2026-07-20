/**
 * internal — Markdown Preview helper.
 *
 * Pure, offline, renderer-side. Lazy-imports `marked` (MIT) for the
 * GFM-flavored render and `dompurify` (MPL-2.0 / Apache-2.0) for the
 * sanitization pass so the panel never lands React-renderable HTML
 * that could leak script execution. Both modules sit inside the
 * Developer Utilities lazy chunk; nothing extra ships in the main
 * editor bundle.
 *
 * Acceptance criterion: the resulting HTML never includes a working
 * remote-image fetch (scope: "no remote image fetch"). We
 * strip `src` and `srcset` from image-capable tags, leaving alt text
 * in place so users still see the placeholder structure.
 */

export interface MarkdownPreviewOptions {
  /** Enable GitHub-flavored extensions (tables, task lists, …). */
  readonly gfm: boolean;
}

export type MarkdownPreviewResult =
  | { ok: true; html: string; sanitizedNodeCount: number }
  | { ok: false; errorKey: string; message?: string };

export const MARKDOWN_PREVIEW_MAX_BYTES = 200 * 1024; // 200 KB
export const MARKDOWN_PREVIEW_MAX_KB = Math.round(MARKDOWN_PREVIEW_MAX_BYTES / 1024);

interface MarkedModule {
  marked?: { parse(source: string, opts?: Record<string, unknown>): string };
  default?: {
    parse(source: string, opts?: Record<string, unknown>): string;
  };
  parse?(source: string, opts?: Record<string, unknown>): string;
}

interface DompurifyModule {
  default?: {
    sanitize(html: string, opts?: Record<string, unknown>): string;
    removed?: unknown[];
  };
  sanitize?(html: string, opts?: Record<string, unknown>): string;
  removed?: unknown[];
}

export async function renderMarkdownPreview(
  source: string,
  options: MarkdownPreviewOptions
): Promise<MarkdownPreviewResult> {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.markdownPreview.error.empty' };
  }

  if (new TextEncoder().encode(source).byteLength > MARKDOWN_PREVIEW_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.markdownPreview.error.tooLarge' };
  }

  let markedModule: MarkedModule;
  try {
    markedModule = (await import('marked')) as unknown as MarkedModule;
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.loadFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const parse =
    markedModule.parse ??
    markedModule.marked?.parse ??
    markedModule.default?.parse;
  if (typeof parse !== 'function') {
    return {
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.loadFailure',
      message: 'marked module did not expose a parse entry point',
    };
  }

  let rawHtml: string;
  try {
    const result = parse(source, { gfm: options.gfm, breaks: false, async: false });
    rawHtml = typeof result === 'string' ? result : '';
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.renderFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // Strip remote-image src attrs before sanitization runs. The
  // sanitizer would let `<img src="https://...">` through as long as
  // the URL scheme is allowlisted, but the AC explicitly forbids any
  // remote-fetch trigger. The regex pre-pass empties the value;
  // DOMPurify is then configured below with `FORBID_ATTR` for `src`
  // and `srcset` as the definitive backstop, so any fetch-capable
  // attribute the regex misses (multiple attrs, weird quoting, etc.)
  // is dropped by the sanitizer instead.
  const noRemoteImg = rawHtml.replace(
    /(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi,
    (_match, prefix: string, quote: string) => `${prefix}${quote}${quote}`
  );

  let dompurifyModule: DompurifyModule;
  try {
    dompurifyModule = (await import('dompurify')) as unknown as DompurifyModule;
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.loadFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const sanitize =
    dompurifyModule.sanitize ?? dompurifyModule.default?.sanitize;
  if (typeof sanitize !== 'function') {
    return {
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.loadFailure',
      message: 'dompurify module did not expose a sanitize entry point',
    };
  }

  let safeHtml: string;
  try {
    const out = sanitize(noRemoteImg, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style'],
      // `src` and `srcset` are in the forbid list as a definitive
      // backstop on top of the regex pre-pass: even if a malformed tag
      // (multiple src attrs, mismatched quotes, raw HTML srcset, etc.)
      // slips through the regex, the sanitizer still strips every
      // image-fetch attribute so no remote fetch can ever fire.
      FORBID_ATTR: ['style', 'onerror', 'onload', 'src', 'srcset'],
    });
    safeHtml = typeof out === 'string' ? out : String(out);
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.markdownPreview.error.renderFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const removedList =
    (dompurifyModule.default?.removed as unknown[] | undefined) ??
    (dompurifyModule.removed as unknown[] | undefined) ??
    [];

  return {
    ok: true,
    html: safeHtml,
    sanitizedNodeCount: Array.isArray(removedList) ? removedList.length : 0,
  };
}
