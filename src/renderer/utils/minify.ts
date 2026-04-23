/**
 * Lightweight minifiers that pair with `formatSource` (Prettier) for the
 * Beautify/Minify developer utility (RL-070 slices 1 + 2). JSON minify is
 * a pure parse + stringify round-trip. JS and HTML minify are intentionally
 * whitespace-stripping passes — NOT full minifiers. A real JS minifier
 * would pull in terser, and a real HTML minifier would pull in
 * html-minifier-terser; both balloon the editor bundle, so they're later
 * slices. The panel surfaces a hint that JS / HTML minify is whitespace-only
 * so expectations stay honest.
 */

export type MinifyLanguage = 'json' | 'javascript' | 'html';

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

export function minifySource(language: MinifyLanguage, source: string): MinifyResult {
  if (language === 'json') return minifyJson(source);
  if (language === 'html') return minifyHtml(source);
  return minifyJavaScript(source);
}
