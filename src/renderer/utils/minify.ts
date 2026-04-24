/**
 * Lightweight minifiers that pair with `formatSource` (Prettier) for the
 * Beautify/Minify developer utility (RL-070 slices 1 / 2 / 3). JSON minify
 * is a pure parse + stringify round-trip. JS, HTML, CSS, and XML minify
 * are intentionally whitespace-stripping passes — NOT full minifiers. A
 * real JS minifier would pull in terser, a real HTML minifier would pull
 * in html-minifier-terser, and a real CSS / XML minifier would pull in
 * cssnano / xml-minifier; all of those balloon the editor bundle, so
 * they're later slices. The panel surfaces a hint per-language so users
 * know minify is scope-bounded.
 */

export type MinifyLanguage = 'json' | 'javascript' | 'html' | 'css' | 'xml';

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
 * Strip comments and collapse whitespace in JS source while preserving every
 * character inside string and template literals and regex literals byte-for-
 * byte. The implementation is a small state machine rather than a regex so
 * the quote/regex detection stays honest — false positives on `"/"` / `"//"`
 * are exactly the bug class that derails "clever" regex minifiers.
 */
function minifyJavaScript(source: string): MinifyResult {
  type Mode =
    | 'code'
    | 'line-comment'
    | 'block-comment'
    | 'single-string'
    | 'double-string'
    | 'template-string'
    | 'regex-literal';

  const output: string[] = [];
  let mode: Mode = 'code';
  let needsWhitespace = false;
  let regexCharClassDepth = 0;
  const length = source.length;

  const isIdentChar = (char: string): boolean =>
    /[A-Za-z0-9_$]/u.test(char);

  const REGEX_PREFIX_KEYWORDS = new Set([
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'new',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]);

  const canStartRegexLiteral = (): boolean => {
    let index = output.length - 1;
    while (index >= 0) {
      const candidate = output[index] ?? '';
      if (candidate !== '') {
        if (!isIdentChar(candidate)) {
          return '([{,;:=!&|?+-*%^~<>'.includes(candidate);
        }

        let start = index;
        while (start >= 0 && isIdentChar(output[start] ?? '')) {
          start -= 1;
        }
        const keyword = output.slice(start + 1, index + 1).join('');
        return REGEX_PREFIX_KEYWORDS.has(keyword);
      }
      index -= 1;
    }
    return true;
  };

  for (let i = 0; i < length; i += 1) {
    const char = source[i] ?? '';
    const next = source[i + 1] ?? '';

    if (mode === 'line-comment') {
      if (char === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        mode = 'code';
        i += 1;
      }
      continue;
    }
    if (
      mode === 'single-string' ||
      mode === 'double-string' ||
      mode === 'template-string' ||
      mode === 'regex-literal'
    ) {
      output.push(char);
      if (char === '\\' && i + 1 < length) {
        // Preserve the next char verbatim (escape sequence).
        output.push(source[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (mode === 'regex-literal') {
        if (char === '[') {
          regexCharClassDepth += 1;
          continue;
        }
        if (char === ']' && regexCharClassDepth > 0) {
          regexCharClassDepth -= 1;
          continue;
        }
        if (char === '/' && regexCharClassDepth === 0) {
          mode = 'code';
        }
        continue;
      }
      const closed =
        (mode === 'single-string' && char === "'") ||
        (mode === 'double-string' && char === '"') ||
        (mode === 'template-string' && char === '`');
      if (closed) mode = 'code';
      continue;
    }

    // Mode === 'code' below here.
    if (char === '/' && next === '/') {
      mode = 'line-comment';
      i += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      mode = 'block-comment';
      i += 1;
      continue;
    }
    if (char === '/' && canStartRegexLiteral()) {
      needsWhitespace = false;
      regexCharClassDepth = 0;
      mode = 'regex-literal';
      output.push(char);
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      // A string/template literal is unambiguously a new token — no space
      // is needed before it regardless of what came before, because
      // identifiers followed by a string literal still tokenize as two
      // separate tokens (`foo"bar"`).
      needsWhitespace = false;
      mode = char === "'" ? 'single-string' : char === '"' ? 'double-string' : 'template-string';
      output.push(char);
      continue;
    }

    if (/\s/u.test(char)) {
      // Mark that we're between tokens. We only emit a real space when the
      // next non-whitespace char is an identifier char AND the previous
      // emitted char was also an identifier char — otherwise whitespace can
      // be dropped without changing semantics (e.g. `a ;` → `a;`).
      needsWhitespace = true;
      continue;
    }

    if (needsWhitespace) {
      const prev = output[output.length - 1] ?? '';
      if (isIdentChar(prev) && isIdentChar(char)) {
        output.push(' ');
      }
      needsWhitespace = false;
    }
    output.push(char);
  }

  return { ok: true, output: output.join('').trim() };
}

/**
 * HTML minify — strips `<!-- ... -->` comments and collapses whitespace in
 * text content / inter-tag gaps / attribute lists, while preserving the
 * content inside `<pre>`, `<textarea>`, `<script>`, and `<style>` tags
 * byte-for-byte. Like the JS pass this is NOT a real minifier — it doesn't
 * rewrite attributes, normalize boolean attrs, or strip optional closing
 * tags. The panel surfaces a hint so users understand the scope.
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
      if (slice.toLowerCase() === preserveCloseTag) {
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
 * CSS minify — strips `/* ... *\/` block comments and collapses whitespace
 * in rule bodies + selectors while preserving content inside single-quoted
 * and double-quoted strings and `url(...)` function bodies byte-for-byte.
 * Drops the trailing `;` before a closing brace (CSS spec allows it).
 *
 * Whitespace policy:
 *   - Consecutive whitespace in declarations collapses to a single space.
 *   - Whitespace around structural chars ({, }, :, ;, ,) is dropped
 *     entirely — CSS does not need it to tokenize correctly.
 *   - Strings + url(...) bodies pass through verbatim.
 */
function minifyCss(source: string): MinifyResult {
  if (source === '') return { ok: true, output: '' };

  type CssMode =
    | 'code'
    | 'block-comment'
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

    // Drop a `;` that sits right before a `}` — CSS spec optional, and
    // stripping it is the single biggest size win of a conservative
    // minifier. Find the next non-whitespace char; if `}`, skip the `;`.
    if (char === ';') {
      let j = i + 1;
      while (j < length && /\s/u.test(source[j] ?? '')) j += 1;
      const next = source[j] ?? '';
      if (next === '}') {
        // Skip the `;` — jump past the whitespace we just scanned; the
        // outer loop will land on `}` next.
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

export function minifySource(language: MinifyLanguage, source: string): MinifyResult {
  if (language === 'json') return minifyJson(source);
  if (language === 'html') return minifyHtml(source);
  if (language === 'css') return minifyCss(source);
  if (language === 'xml') return minifyXml(source);
  return minifyJavaScript(source);
}
