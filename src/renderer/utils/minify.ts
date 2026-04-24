/**
 * Minifiers that pair with `formatSource` (Prettier) for the
 * Beautify/Minify developer utility (RL-070). Coverage:
 *
 *   - JSON: pure parse + stringify round-trip.
 *   - JavaScript: terser v5 (real ECMAScript minifier — mangling,
 *     dead-code elimination, expression compaction). Lazy-imported so
 *     the ~100 KB gzipped bundle only ships when the panel runs.
 *   - HTML / XML: hand-rolled whitespace-only state machines that
 *     preserve preserve-tag / CDATA / PI / attribute-string contents
 *     byte-for-byte. A full html-minifier-terser / xml-minifier is a
 *     later slice; the panel surfaces a hint so expectations stay
 *     honest.
 *   - CSS / SCSS / LESS: shared state machine — same whitespace-only
 *     collapse, with `//` line comments stripped for SCSS / LESS (CSS
 *     has no `//` outside strings / url()).
 *
 * The dispatcher is async because terser's API is Promise-based;
 * every unit-test and panel call site awaits the result.
 */

export type MinifyLanguage =
  | 'json'
  | 'javascript'
  | 'html'
  | 'css'
  | 'scss'
  | 'less'
  | 'xml';

export type MinifyResult =
  | { ok: true; output: string }
  | { ok: false; reason: 'parse-error'; message: string };

function minifyJson(source: string): MinifyResult {
  if (source.trim() === '') {
    return { ok: true, output: '' };
  }
  try {
    // `undefined, 0` produces the compact, separator-free form.
    return { ok: true, output: JSON.stringify(JSON.parse(source)) };
  } catch (error) {
    return {
      ok: false,
      reason: 'parse-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Minify JS source via terser — the real-deal ECMAScript minifier:
 * scope-aware variable mangling, dead-code elimination, expression
 * compaction, safe short-circuiting of comparisons. Imported lazily
 * so terser's ~100 KB gzipped footprint only ships when the panel
 * actually runs.
 *
 * Terser's API rejects on parse errors — we catch and map to the
 * tagged-union `parse-error` branch so the panel can render a
 * translated banner without a try/catch.
 */
async function minifyJavaScript(source: string): Promise<MinifyResult> {
  if (source.trim() === '') return { ok: true, output: '' };
  try {
    const terser = await import('terser');
    const result = await terser.minify(source);
    if (typeof result.code !== 'string') {
      return {
        ok: false,
        reason: 'parse-error',
        message: 'terser returned no code',
      };
    }
    return { ok: true, output: result.code };
  } catch (error) {
    return {
      ok: false,
      reason: 'parse-error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * HTML minify — strips `<!-- ... -->` comments and collapses whitespace in
 * text content / inter-tag gaps / attribute lists, while preserving the
 * content inside `<pre>`, `<textarea>`, `<script>`, and `<style>` tags
 * byte-for-byte. NOT a full minifier — it doesn't rewrite attributes,
 * normalize boolean attrs, or strip optional closing tags. The panel
 * surfaces a hint so users understand the scope.
 *
 * Whitespace policy in text content:
 *   - Consecutive whitespace collapses to a single space.
 *   - Whitespace immediately after `>` (between a tag close and the next
 *     text) is dropped.
 *   - Whitespace immediately before `<` (between text and the next tag) is
 *     dropped.
 *   - Leading / trailing whitespace in the document is trimmed.
 * This is more aggressive than "conservative collapse" but simple and
 * predictable.
 */
function minifyHtml(source: string): MinifyResult {
  if (source === '') return { ok: true, output: '' };

  type HtmlMode =
    | 'text'
    | 'tag'
    | 'tag-single-string'
    | 'tag-double-string'
    | 'comment'
    | 'preserve';

  const PRESERVE_TAGS = new Set(['pre', 'textarea', 'script', 'style']);
  const isCloseTagBoundary = (value: string): boolean => value === '>' || /\s/u.test(value);

  const output: string[] = [];
  let mode: HtmlMode = 'text';
  let preserveCloseTag = '';
  let tagBuffer = '';
  let i = 0;
  const length = source.length;

  while (i < length) {
    const char = source[i] ?? '';

    if (mode === 'comment') {
      if (char === '-' && source[i + 1] === '-' && source[i + 2] === '>') {
        mode = 'text';
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'preserve') {
      const slice = source.slice(i, i + preserveCloseTag.length);
      const boundary = source[i + preserveCloseTag.length] ?? '';
      if (slice.toLowerCase() === preserveCloseTag && isCloseTagBoundary(boundary)) {
        output.push(source.slice(i, i + preserveCloseTag.length));
        // Hand control to tag mode so whatever trailing whitespace /
        // attributes sit between `</tagname` and the final `>` are
        // processed with tag-mode rules (attr collapsing, quoted string
        // preservation) rather than leaking into text mode.
        tagBuffer = preserveCloseTag.slice(1);
        i += preserveCloseTag.length;
        mode = 'tag';
        continue;
      }
      output.push(char);
      i += 1;
      continue;
    }

    if (mode === 'tag-single-string' || mode === 'tag-double-string') {
      output.push(char);
      tagBuffer += char;
      if (
        (mode === 'tag-single-string' && char === "'") ||
        (mode === 'tag-double-string' && char === '"')
      ) {
        mode = 'tag';
      }
      i += 1;
      continue;
    }

    if (mode === 'tag') {
      if (char === "'") {
        output.push(char);
        tagBuffer += char;
        mode = 'tag-single-string';
        i += 1;
        continue;
      }
      if (char === '"') {
        output.push(char);
        tagBuffer += char;
        mode = 'tag-double-string';
        i += 1;
        continue;
      }
      if (char === '>') {
        // Trim trailing whitespace inside the tag — collapsed attr gaps
        // shouldn't leak past the closing `>`. Matches XML tag behavior.
        while (output.length > 0 && output[output.length - 1] === ' ') {
          output.pop();
        }
        output.push('>');
        const trimmed = tagBuffer.trim();
        const isClosing = trimmed.startsWith('/');
        const isSelfClosing = trimmed.endsWith('/');
        const nameSource = isClosing ? trimmed.slice(1) : trimmed;
        const firstToken = nameSource.split(/\s/)[0] ?? '';
        const tagName = firstToken.replace(/\/$/, '').toLowerCase();
        if (!isClosing && !isSelfClosing && PRESERVE_TAGS.has(tagName)) {
          mode = 'preserve';
          preserveCloseTag = `</${tagName}`;
        } else {
          mode = 'text';
        }
        tagBuffer = '';
        i += 1;
        continue;
      }
      if (/\s/u.test(char)) {
        // Collapse whitespace between attributes to a single space.
        const last = output[output.length - 1] ?? '';
        if (last !== ' ' && last !== '<' && last !== '/') {
          output.push(' ');
          tagBuffer += ' ';
        }
        i += 1;
        continue;
      }
      output.push(char);
      tagBuffer += char;
      i += 1;
      continue;
    }

    // mode === 'text'
    if (
      char === '<' &&
      source[i + 1] === '!' &&
      source[i + 2] === '-' &&
      source[i + 3] === '-'
    ) {
      mode = 'comment';
      i += 4;
      continue;
    }
    if (char === '<') {
      // Drop any whitespace that was emitted just before the tag.
      while (output.length > 0 && output[output.length - 1] === ' ') {
        output.pop();
      }
      output.push('<');
      tagBuffer = '';
      mode = 'tag';
      i += 1;
      continue;
    }
    if (/\s/u.test(char)) {
      // Collapse consecutive whitespace to a single space. Skip entirely
      // when the previous emitted char is a tag-close `>` (drop whitespace
      // that sits between a tag boundary and the next text) or another
      // space (dedupe) or the very start of the stream.
      const last = output[output.length - 1] ?? '';
      if (last !== '>' && last !== ' ' && last !== '') {
        output.push(' ');
      }
      i += 1;
      continue;
    }
    output.push(char);
    i += 1;
  }

  return { ok: true, output: output.join('').trim() };
}

/**
 * CSS / SCSS / LESS minify — strips `/* ... *\/` block comments,
 * strips `//` line comments (legal in SCSS + LESS; CSS has no `//` in
 * code mode so stripping is a no-op there), and collapses whitespace
 * in rule bodies + selectors while preserving content inside
 * single-quoted and double-quoted strings and `url(...)` function
 * bodies byte-for-byte. Drops the trailing `;` before a closing brace
 * (spec allows it in all three languages).
 *
 * Whitespace policy:
 *   - Consecutive whitespace in declarations collapses to a single space.
 *   - Whitespace around structural chars ({, }, :, ;, ,) is dropped
 *     entirely — the grammar does not need it to tokenize correctly.
 *   - Strings + url(...) bodies pass through verbatim.
 */
function minifyCss(source: string): MinifyResult {
  if (source === '') return { ok: true, output: '' };

  type CssMode =
    | 'code'
    | 'block-comment'
    | 'line-comment'
    | 'single-string'
    | 'double-string'
    | 'url-unquoted';

  // Asymmetric whitespace-drop rules around structural chars. `{`, `}`, `:`,
  // `;`, `,`, `>` drop whitespace on either side. `(` only drops AFTER
  // itself (keep the space before — `@media (…)` requires it). `)` only
  // drops BEFORE itself (keep the space after — that space can matter to
  // the next token).
  const DROP_BEFORE = new Set(['{', '}', ':', ';', ',', '>', ')']);
  const DROP_AFTER = new Set(['{', '}', ':', ';', ',', '>', '(']);

  const output: string[] = [];
  let mode: CssMode = 'code';
  let pendingWhitespace = false;
  let i = 0;
  const length = source.length;

  while (i < length) {
    const char = source[i] ?? '';

    if (mode === 'block-comment') {
      if (char === '*' && source[i + 1] === '/') {
        mode = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'line-comment') {
      // Consume through end-of-line. The newline itself is dropped too
      // — it'll be recreated by the whitespace-collapse pass if the
      // next real token needs separation.
      if (char === '\n') mode = 'code';
      i += 1;
      continue;
    }

    if (mode === 'single-string') {
      output.push(char);
      if (char === '\\' && i + 1 < length) {
        // Preserve the next char verbatim (escape sequence).
        output.push(source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (char === "'") mode = 'code';
      i += 1;
      continue;
    }
    if (mode === 'double-string') {
      output.push(char);
      if (char === '\\' && i + 1 < length) {
        output.push(source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (char === '"') mode = 'code';
      i += 1;
      continue;
    }
    if (mode === 'url-unquoted') {
      // Inside url(...) with unquoted content. Preserve every char until
      // the matching `)`.
      output.push(char);
      if (char === '\\' && i + 1 < length) {
        output.push(source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (char === ')') {
        mode = 'code';
      }
      i += 1;
      continue;
    }

    // mode === 'code'
    if (char === '/' && source[i + 1] === '*') {
      mode = 'block-comment';
      i += 2;
      continue;
    }
    // SCSS + LESS line comments. Plain CSS has no legal `//` in code
    // mode, so stripping unconditionally is safe — the url() and string
    // preserve modes above catch the contexts where `//` appears as
    // literal content.
    if (char === '/' && source[i + 1] === '/') {
      mode = 'line-comment';
      i += 2;
      continue;
    }
    if (char === "'") {
      pendingWhitespace = false;
      mode = 'single-string';
      output.push(char);
      i += 1;
      continue;
    }
    if (char === '"') {
      pendingWhitespace = false;
      mode = 'double-string';
      output.push(char);
      i += 1;
      continue;
    }

    // Detect `url(` (case-insensitive) with either a quoted or unquoted
    // body. The quoted body naturally falls into single/double-string
    // modes; for the unquoted body we need a dedicated preserve branch.
    if (char === '(' && output.length >= 3) {
      const last3 = output.slice(-3).join('').toLowerCase();
      if (last3 === 'url') {
        output.push('(');
        // Skip whitespace inside url( … ) up to the first real content
        // char; if it's a quote the string modes take over; otherwise
        // we enter url-unquoted mode.
        let j = i + 1;
        while (j < length && /\s/u.test(source[j] ?? '')) j += 1;
        const next = source[j] ?? '';
        if (next === "'" || next === '"') {
          // Leave code-mode; the string mode will pick up on the next
          // iteration. We still emit nothing for the skipped whitespace
          // because CSS treats url( "x" ) and url("x") as equivalent.
          i = j;
          continue;
        }
        // Unquoted url body — preserve byte-for-byte until `)`.
        mode = 'url-unquoted';
        i = j;
        continue;
      }
    }

    if (/\s/u.test(char)) {
      pendingWhitespace = true;
      i += 1;
      continue;
    }

    // Non-whitespace code char. Decide whether to emit the pending
    // whitespace first.
    if (pendingWhitespace) {
      const last = output[output.length - 1] ?? '';
      // Drop whitespace when either side is structural; otherwise collapse
      // to a single space. `last === ''` is the start of the stream —
      // never emit leading whitespace.
      if (!DROP_BEFORE.has(char) && !DROP_AFTER.has(last) && last !== '') {
        output.push(' ');
      }
      pendingWhitespace = false;
    }

    // Drop a `;` that sits right before a `}` — the grammar treats the
    // trailing semicolon as optional, and stripping it is the single
    // biggest size win of a conservative minifier. The look-ahead skips
    // whitespace AND comments (both `//` for SCSS / LESS and `/* */`
    // for all three) so declarations like `color: red; // note` still
    // lose the trailing `;` when followed by `}`.
    if (char === ';') {
      let j = i + 1;
      while (j < length) {
        const nextChar = source[j] ?? '';
        if (/\s/u.test(nextChar)) {
          j += 1;
          continue;
        }
        if (nextChar === '/' && source[j + 1] === '/') {
          j += 2;
          while (j < length && source[j] !== '\n') j += 1;
          continue;
        }
        if (nextChar === '/' && source[j + 1] === '*') {
          j += 2;
          while (
            j + 1 < length &&
            !(source[j] === '*' && source[j + 1] === '/')
          ) {
            j += 1;
          }
          j += 2; // past the closing `*/`
          continue;
        }
        break;
      }
      if (source[j] === '}') {
        i = j;
        continue;
      }
    }

    output.push(char);
    i += 1;
  }

  return { ok: true, output: output.join('').trim() };
}

/**
 * XML minify — strips `<!-- -->` comments and collapses inter-tag
 * whitespace while preserving content inside CDATA sections
 * (`<![CDATA[...]]>`), processing instructions (`<?...?>`), and quoted
 * attribute values byte-for-byte. Unlike HTML, XML has no implicit
 * "preserve these tag contents" set — element text content follows the
 * same whitespace-collapsing rules as the rest of the document.
 * Callers who need significant whitespace should use `xml:space="preserve"`
 * in their source — a real XML minifier would honour that; this one
 * does not (documented in the i18n hint).
 */
function minifyXml(source: string): MinifyResult {
  if (source === '') return { ok: true, output: '' };

  type XmlMode =
    | 'text'
    | 'tag'
    | 'tag-single-string'
    | 'tag-double-string'
    | 'comment'
    | 'cdata'
    | 'pi';

  const output: string[] = [];
  let mode: XmlMode = 'text';
  let i = 0;
  const length = source.length;

  while (i < length) {
    const char = source[i] ?? '';

    if (mode === 'comment') {
      if (char === '-' && source[i + 1] === '-' && source[i + 2] === '>') {
        mode = 'text';
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'cdata') {
      output.push(char);
      if (
        char === ']' &&
        source[i + 1] === ']' &&
        source[i + 2] === '>'
      ) {
        output.push(']', '>');
        i += 3;
        mode = 'text';
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'pi') {
      output.push(char);
      if (char === '?' && source[i + 1] === '>') {
        output.push('>');
        i += 2;
        mode = 'text';
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'tag-single-string' || mode === 'tag-double-string') {
      output.push(char);
      if (
        (mode === 'tag-single-string' && char === "'") ||
        (mode === 'tag-double-string' && char === '"')
      ) {
        mode = 'tag';
      }
      i += 1;
      continue;
    }

    if (mode === 'tag') {
      if (char === "'") {
        output.push(char);
        mode = 'tag-single-string';
        i += 1;
        continue;
      }
      if (char === '"') {
        output.push(char);
        mode = 'tag-double-string';
        i += 1;
        continue;
      }
      if (char === '>') {
        // Trim any trailing whitespace inside the tag — collapsed attr
        // gaps shouldn't bleed past the closing `>`.
        while (output.length > 0 && output[output.length - 1] === ' ') {
          output.pop();
        }
        output.push('>');
        mode = 'text';
        i += 1;
        continue;
      }
      if (/\s/u.test(char)) {
        const last = output[output.length - 1] ?? '';
        if (last !== ' ' && last !== '<' && last !== '/') {
          output.push(' ');
        }
        i += 1;
        continue;
      }
      output.push(char);
      i += 1;
      continue;
    }

    // mode === 'text'
    if (
      char === '<' &&
      source[i + 1] === '!' &&
      source[i + 2] === '[' &&
      source.slice(i + 3, i + 8) === 'CDATA' &&
      source[i + 8] === '['
    ) {
      output.push('<![CDATA[');
      i += 9;
      mode = 'cdata';
      continue;
    }
    if (
      char === '<' &&
      source[i + 1] === '!' &&
      source[i + 2] === '-' &&
      source[i + 3] === '-'
    ) {
      mode = 'comment';
      i += 4;
      continue;
    }
    if (char === '<' && source[i + 1] === '?') {
      output.push('<', '?');
      i += 2;
      mode = 'pi';
      continue;
    }
    if (char === '<') {
      while (output.length > 0 && output[output.length - 1] === ' ') {
        output.pop();
      }
      output.push('<');
      mode = 'tag';
      i += 1;
      continue;
    }
    if (/\s/u.test(char)) {
      const last = output[output.length - 1] ?? '';
      if (last !== '>' && last !== ' ' && last !== '') {
        output.push(' ');
      }
      i += 1;
      continue;
    }
    output.push(char);
    i += 1;
  }

  return { ok: true, output: output.join('').trim() };
}

export async function minifySource(
  language: MinifyLanguage,
  source: string
): Promise<MinifyResult> {
  if (language === 'json') return minifyJson(source);
  if (language === 'html') return minifyHtml(source);
  if (language === 'css' || language === 'scss' || language === 'less') {
    return minifyCss(source);
  }
  if (language === 'xml') return minifyXml(source);
  return minifyJavaScript(source);
}
