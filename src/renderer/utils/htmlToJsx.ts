/**
 * RL-070 — HTML → JSX converter helper.
 *
 * Pure, offline, renderer-side. Takes HTML markup and returns a JSX-safe
 * string suitable for dropping into a React component. No runtime deps:
 * `DOMParser` is a browser built-in and jsdom ships a compatible
 * implementation for tests.
 *
 * The walker emits 2-space-indented JSX with:
 *
 * - Attribute name translation via a hand-rolled table (`class` →
 *   `className`, `for` → `htmlFor`, `tabindex` → `tabIndex`, common
 *   event handlers camelCased, …). `data-*` and `aria-*` pass through
 *   verbatim; anything else falls back to camelCase on hyphen
 *   boundaries.
 * - Inline `style="…"` parsed into an object literal with CSS
 *   property names camelCased (`background-color` → `backgroundColor`).
 * - Void elements emitted as self-closing (`<br />`, `<img />`, …).
 * - `{` / `}` in text nodes escaped as `{'{'}` / `{'}'}` so JSX
 *   doesn't mistake them for interpolations.
 * - HTML comments converted to JSX comments (braces + slash-star).
 * - `<script>` / `<style>` children preserved via a template-literal
 *   string child so JSX stays parseable without any raw-HTML injection
 *   escape hatch.
 *
 * The 200 KB byte cap (UTF-8) protects against runaway conversion on
 * pathological blobs.
 */

export interface HtmlToJsxOptions {
  /**
   * Wrap multi-root output in a React fragment (`<>…</>`). When there
   * is a single root element this has no effect.
   */
  readonly wrapInFragment?: boolean;
}

export type HtmlToJsxResult =
  | { ok: true; jsx: string; rootCount: number }
  | { ok: false; errorKey: string; message?: string };

export const HTML_TO_JSX_MAX_BYTES = 200 * 1024; // 200 KB
export const HTML_TO_JSX_MAX_KB = Math.round(HTML_TO_JSX_MAX_BYTES / 1024);
export const HTML_TO_JSX_MAX_DEPTH = 200;
export const HTML_TO_JSX_MAX_NODES = 5_000;
export const HTML_TO_JSX_MAX_OUTPUT_BYTES = 512 * 1024;

/** Void HTML elements that must self-close in JSX. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

/** Boolean HTML attributes whose presence alone conveys `true` in JSX. */
const BOOLEAN_ATTRS = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'ismap',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

/**
 * Curated HTML-attribute → React-prop translation table. Covers the ~30
 * props where the name literally differs (not just case). Anything not
 * listed here falls through to the camelCase default, except `data-*`
 * and `aria-*` which React keeps kebab-cased.
 */
const ATTR_NAME_MAP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  charset: 'charSet',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  rowspan: 'rowSpan',
  colspan: 'colSpan',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  enctype: 'encType',
  formaction: 'formAction',
  formenctype: 'formEncType',
  formmethod: 'formMethod',
  formnovalidate: 'formNoValidate',
  formtarget: 'formTarget',
  frameborder: 'frameBorder',
  hreflang: 'hrefLang',
  inputmode: 'inputMode',
  autocapitalize: 'autoCapitalize',
  autocomplete: 'autoComplete',
  autocorrect: 'autoCorrect',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv',
  srcdoc: 'srcDoc',
  srclang: 'srcLang',
  srcset: 'srcSet',
  usemap: 'useMap',
  allowfullscreen: 'allowFullScreen',
  playsinline: 'playsInline',
  spellcheck: 'spellCheck',
  novalidate: 'noValidate',
  referrerpolicy: 'referrerPolicy',
};

export function convertHtmlToJsx(
  html: string,
  options: HtmlToJsxOptions = {}
): HtmlToJsxResult {
  const trimmed = html.trim();
  if (trimmed.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.htmlToJsx.error.empty' };
  }

  const byteLength = new TextEncoder().encode(html).byteLength;
  if (byteLength > HTML_TO_JSX_MAX_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.htmlToJsx.error.tooLarge' };
  }

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(trimmed, 'text/html');
  } catch (error) {
    return {
      ok: false,
      errorKey: 'utilities.tool.htmlToJsx.error.parseFailure',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // `DOMParser('text/html')` promotes top-level `<meta>` / `<title>` /
  // `<link>` / `<base>` / `<style>` into `<head>` even for fragment
  // input. Concatenating `head.childNodes` + `body.childNodes` keeps
  // those user-visible inputs from silently disappearing — the panel
  // still sees them as top-level roots for conversion.
  const roots = [
    ...Array.from(doc.head.childNodes),
    ...Array.from(doc.body.childNodes),
  ].filter((node) => !isIgnorableWhitespace(node));
  if (roots.length === 0) {
    return { ok: false, errorKey: 'utilities.tool.htmlToJsx.error.empty' };
  }

  // Fragment wrap only applies when there's more than one root; with a
  // single root, emit it at indent 0 regardless of the toggle so users
  // paste the raw element into JSX without stripping leading whitespace.
  const shouldWrap = (options.wrapInFragment ?? roots.length > 1) && roots.length > 1;
  const renderContext: RenderContext = { nodes: 0, tooLarge: false };
  const rendered = roots
    .map((node) => renderNode(node, shouldWrap ? 1 : 0, renderContext))
    .filter((line) => line.length > 0)
    .join('\n');
  if (renderContext.tooLarge) {
    return { ok: false, errorKey: 'utilities.tool.htmlToJsx.error.tooLarge' };
  }

  const jsx = shouldWrap ? ['<>', rendered, '</>'].join('\n') : rendered;
  if (new TextEncoder().encode(jsx).byteLength > HTML_TO_JSX_MAX_OUTPUT_BYTES) {
    return { ok: false, errorKey: 'utilities.tool.htmlToJsx.error.tooLarge' };
  }

  return { ok: true, jsx, rootCount: roots.length };
}

interface RenderContext {
  nodes: number;
  tooLarge: boolean;
}

function isIgnorableWhitespace(node: Node): boolean {
  return node.nodeType === 3 /* TEXT_NODE */ && (node.textContent ?? '').trim().length === 0;
}

function renderNode(node: Node, indent: number, context: RenderContext): string {
  if (context.tooLarge) return '';
  context.nodes += 1;
  if (context.nodes > HTML_TO_JSX_MAX_NODES || indent > HTML_TO_JSX_MAX_DEPTH) {
    context.tooLarge = true;
    return '';
  }

  const pad = '  '.repeat(indent);

  if (node.nodeType === 3 /* TEXT_NODE */) {
    const raw = node.textContent ?? '';
    if (raw.trim().length === 0) return '';
    return `${pad}${escapeTextForJsx(raw)}`;
  }

  if (node.nodeType === 8 /* COMMENT_NODE */) {
    const body = (node.textContent ?? '').trim();
    return `${pad}{/* ${body.replace(/\*\//g, '* /')} */}`;
  }

  if (node.nodeType !== 1 /* ELEMENT_NODE */) {
    return '';
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const attrs = renderAttributes(element);

  if (VOID_ELEMENTS.has(tag)) {
    return `${pad}<${tag}${attrs.length > 0 ? ' ' + attrs : ''} />`;
  }

  // <script> and <style> get their raw body as a template-literal child
  // so JSX doesn't try to parse `<`/`>` inside. Safer than any raw-HTML
  // injection hatch and keeps the output copy-pasteable.
  if (tag === 'script' || tag === 'style') {
    const body = element.textContent ?? '';
    if (body.length === 0) {
      return `${pad}<${tag}${attrs.length > 0 ? ' ' + attrs : ''} />`;
    }
    const escaped = escapeTemplateLiteralText(body);
    return `${pad}<${tag}${attrs.length > 0 ? ' ' + attrs : ''}>{\`${escaped}\`}</${tag}>`;
  }

  const children = Array.from(element.childNodes)
    .map((child) => renderNode(child, indent + 1, context))
    .filter((line) => line.length > 0);

  if (children.length === 0) {
    return `${pad}<${tag}${attrs.length > 0 ? ' ' + attrs : ''} />`;
  }

  return [
    `${pad}<${tag}${attrs.length > 0 ? ' ' + attrs : ''}>`,
    ...children,
    `${pad}</${tag}>`,
  ].join('\n');
}

function renderAttributes(element: Element): string {
  const parts: string[] = [];
  for (const attr of Array.from(element.attributes)) {
    parts.push(renderAttribute(attr.name, attr.value));
  }
  return parts.join(' ');
}

function renderAttribute(rawName: string, rawValue: string): string {
  const lowerName = rawName.toLowerCase();
  const propName = translateAttributeName(lowerName);

  // Boolean attrs with empty value get emitted as bare props, which React
  // infers as `true`. With a value (e.g. `checked="checked"`), still bare.
  if (BOOLEAN_ATTRS.has(lowerName)) {
    return propName;
  }

  if (lowerName === 'style') {
    return `style={${renderStyleObject(rawValue)}}`;
  }

  // Numeric-typed props emit as expressions so React gets a number.
  if (lowerName === 'tabindex' || lowerName === 'rowspan' || lowerName === 'colspan') {
    const numeric = Number.parseInt(rawValue, 10);
    if (!Number.isNaN(numeric)) {
      return `${propName}={${numeric}}`;
    }
  }

  return `${propName}="${escapeAttributeValue(rawValue)}"`;
}

function translateAttributeName(lowerName: string): string {
  if (ATTR_NAME_MAP[lowerName]) return ATTR_NAME_MAP[lowerName];
  // Preserve data-* and aria-* verbatim.
  if (lowerName.startsWith('data-') || lowerName.startsWith('aria-')) return lowerName;
  // Event handlers: onclick → onClick, ontouchstart → onTouchStart.
  if (lowerName.startsWith('on') && lowerName.length > 2) {
    return 'on' + lowerName.slice(2, 3).toUpperCase() + camelCaseAfterHyphens(lowerName.slice(3));
  }
  // Fallback: camelCase on hyphen boundaries (accept-charset → acceptCharset).
  if (lowerName.includes('-')) {
    return camelCaseAfterHyphens(lowerName);
  }
  return lowerName;
}

function camelCaseAfterHyphens(value: string): string {
  return value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '&quot;');
}

function escapeTextForJsx(text: string): string {
  // Replace JSX control characters with string-literal children so
  // decoded entities like `&lt;` don't become raw `<` tokens.
  let escaped = '';
  for (const char of text) {
    if (char === '{') {
      escaped += "{'{'}";
    } else if (char === '}') {
      escaped += "{'}'}";
    } else if (char === '<') {
      escaped += "{'<'}";
    } else {
      escaped += char;
    }
  }
  return escaped;
}

function escapeTemplateLiteralText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

function renderStyleObject(value: string): string {
  const declarations = splitStyleDeclarations(value)
    .map((decl) => decl.trim())
    .filter((decl) => decl.length > 0);
  const entries: string[] = [];
  for (const decl of declarations) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const rawProp = decl.slice(0, colon).trim();
    const rawVal = decl.slice(colon + 1).trim();
    if (rawProp.length === 0) continue;
    // Preserve CSS custom properties (--foo) verbatim; they get quoted keys.
    const key = rawProp.startsWith('--')
      ? JSON.stringify(rawProp)
      : camelCaseCssProperty(rawProp);
    entries.push(`${key}: ${JSON.stringify(rawVal)}`);
  }
  if (entries.length === 0) return '{}';
  return `{ ${entries.join(', ')} }`;
}

function splitStyleDeclarations(value: string): string[] {
  const declarations: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let parenDepth = 0;
  let escaped = false;

  for (const char of value) {
    current += char;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') {
      parenDepth += 1;
      continue;
    }
    if (char === ')' && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }
    if (char === ';' && parenDepth === 0) {
      declarations.push(current.slice(0, -1));
      current = '';
    }
  }

  if (current.length > 0) {
    declarations.push(current);
  }

  return declarations;
}

function camelCaseCssProperty(prop: string): string {
  const lower = prop.toLowerCase();
  // `-webkit-transition` → `WebkitTransition`, `-moz-foo` → `MozFoo`.
  if (lower.startsWith('-')) {
    const inner = lower.slice(1);
    const camel = camelCaseAfterHyphens(inner);
    return camel.charAt(0).toUpperCase() + camel.slice(1);
  }
  return camelCaseAfterHyphens(lower);
}
