/**
 * Lightweight minifiers that pair with `formatSource` (Prettier) for the
 * Beautify/Minify developer utility (RL-070 slice 1). JSON minify is a pure
 * parse + stringify round-trip. JS minify is intentionally a
 * whitespace-stripping pass — NOT a full minifier. A real minifier would
 * pull in terser and balloon the editor bundle; that's a later slice. The
 * panel surfaces a hint that JS minify is whitespace-only so expectations
 * stay honest.
 */

export type MinifyLanguage = 'json' | 'javascript';

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

export function minifySource(language: MinifyLanguage, source: string): MinifyResult {
  if (language === 'json') return minifyJson(source);
  return minifyJavaScript(source);
}
