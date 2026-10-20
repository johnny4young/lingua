/**
 * Token-by-token gloss of a JavaScript regular expression, from a small local
 * parser: no network and no dependency. It explains the top level of the
 * pattern; groups summarize their contents. Callers translate each part.
 */

type RegexPart =
  | { kind: 'literal'; text: string }
  | { kind: 'any' }
  | { kind: 'escape'; name: EscapeName }
  | { kind: 'escapedChar'; char: string }
  | { kind: 'codePoint'; char: string }
  | { kind: 'control'; letter: string }
  | { kind: 'backref'; ref: string }
  | { kind: 'property'; negated: boolean; name: string }
  | { kind: 'class'; negated: boolean; body: string }
  | { kind: 'start'; multiline: boolean }
  | { kind: 'end'; multiline: boolean }
  | { kind: 'or' }
  | {
      kind: 'group';
      role: GroupRole;
      index?: number;
      name?: string;
      inner: RegexToken[];
    };

type EscapeName =
  | 'digit'
  | 'nonDigit'
  | 'word'
  | 'nonWord'
  | 'space'
  | 'nonSpace'
  | 'boundary'
  | 'nonBoundary'
  | 'newline'
  | 'tab'
  | 'return'
  | 'formFeed'
  | 'verticalTab'
  | 'null';

type GroupRole =
  | 'capture'
  | 'named'
  | 'plain'
  | 'lookahead'
  | 'negativeLookahead'
  | 'lookbehind'
  | 'negativeLookbehind';

type RegexQuantifier =
  | { kind: 'oneOrMore' | 'zeroOrMore' | 'optional'; lazy: boolean }
  | { kind: 'exactly'; min: number; lazy: boolean }
  | { kind: 'atLeast'; min: number; lazy: boolean }
  | { kind: 'between'; min: number; max: number; lazy: boolean };

export interface RegexToken {
  /** The pattern text this token covers, quantifier included. */
  source: string;
  part: RegexPart;
  quantifier?: RegexQuantifier;
}

const ESCAPES: Record<string, EscapeName> = {
  d: 'digit',
  D: 'nonDigit',
  w: 'word',
  W: 'nonWord',
  s: 'space',
  S: 'nonSpace',
  b: 'boundary',
  B: 'nonBoundary',
  n: 'newline',
  t: 'tab',
  r: 'return',
  f: 'formFeed',
  v: 'verticalTab',
};

/** Parses `pattern`; returns null when the engine itself rejects it. */
export function explainRegex(pattern: string, flags = ''): RegexToken[] | null {
  try {
    new RegExp(pattern, flags);
  } catch {
    return null;
  }
  const state: ParseState = {
    pos: 0,
    group: 0,
    multiline: flags.includes('m'),
    unicode: /[uv]/u.test(flags),
    namedGroups: /\(\?<(?![=!])/u.test(pattern),
  };
  return parseSequence(pattern, state, false);
}

interface ParseState {
  pos: number;
  group: number;
  multiline: boolean;
  /** Without u or v, \p and \k are plain letters (\k also needs a named group). */
  unicode: boolean;
  namedGroups: boolean;
}

function parseSequence(source: string, state: ParseState, nested: boolean): RegexToken[] {
  const tokens: RegexToken[] = [];
  while (state.pos < source.length) {
    if (nested && source[state.pos] === ')') break;
    const start = state.pos;
    const part = parseAtom(source, state);
    // Every atom consumes input, so a parse slip can never loop.
    state.pos = Math.max(state.pos, start + 1);
    const quantifier = parseQuantifier(source, state);
    const token: RegexToken = {
      source: source.slice(start, state.pos),
      part,
      ...(quantifier ? { quantifier } : {}),
    };
    const previous = tokens[tokens.length - 1];
    // Runs of plain characters read as one literal, as long as neither is quantified.
    if (
      part.kind === 'literal' &&
      !quantifier &&
      previous?.part.kind === 'literal' &&
      !previous.quantifier
    ) {
      previous.part = { kind: 'literal', text: previous.part.text + part.text };
      previous.source += token.source;
      continue;
    }
    tokens.push(token);
  }
  return tokens;
}

function parseAtom(source: string, state: ParseState): RegexPart {
  const char = source[state.pos] ?? '';
  state.pos += 1;
  switch (char) {
    case '.':
      return { kind: 'any' };
    case '^':
      return { kind: 'start', multiline: state.multiline };
    case '$':
      return { kind: 'end', multiline: state.multiline };
    case '|':
      return { kind: 'or' };
    case '\\':
      return parseEscape(source, state);
    case '[':
      return parseClass(source, state);
    case '(':
      return parseGroup(source, state);
    default:
      return { kind: 'literal', text: char };
  }
}

function parseEscape(source: string, state: ParseState): RegexPart {
  const char = source[state.pos] ?? '';
  state.pos += 1;
  const named = ESCAPES[char];
  if (named) return { kind: 'escape', name: named };
  if (char === '0' && !/\d/u.test(source[state.pos] ?? '')) return { kind: 'escape', name: 'null' };
  const code = parseCodePoint(source, state, char);
  if (code !== null) return { kind: 'codePoint', char: code };
  if (char === 'c' && /[A-Za-z]/u.test(source[state.pos] ?? '')) {
    const letter = (source[state.pos] ?? '').toUpperCase();
    state.pos += 1;
    return { kind: 'control', letter };
  }
  if (/[1-9]/u.test(char)) {
    let ref = char;
    while (/\d/u.test(source[state.pos] ?? '')) {
      ref += source[state.pos];
      state.pos += 1;
    }
    return { kind: 'backref', ref };
  }
  const close = (end: string) => source.indexOf(end, state.pos);
  const backrefsOn = state.unicode || state.namedGroups;
  if (char === 'k' && backrefsOn && source[state.pos] === '<' && close('>') !== -1) {
    const end = close('>');
    const ref = source.slice(state.pos + 1, end);
    state.pos = end + 1;
    return { kind: 'backref', ref };
  }
  const isProperty = char === 'p' || char === 'P';
  if (isProperty && state.unicode && source[state.pos] === '{' && close('}') !== -1) {
    const end = close('}');
    const name = source.slice(state.pos + 1, end);
    state.pos = end + 1;
    return { kind: 'property', negated: char === 'P', name };
  }
  return { kind: 'escapedChar', char };
}

/** \xHH, \uHHHH and, with u or v, \u{H…}: the character they name, or null. */
function parseCodePoint(source: string, state: ParseState, char: string): string | null {
  const rest = source.slice(state.pos);
  const match =
    char === 'x'
      ? /^[\da-fA-F]{2}/u.exec(rest)
      : char === 'u'
        ? (state.unicode ? /^\{([\da-fA-F]+)\}/u.exec(rest) : null) ?? /^[\da-fA-F]{4}/u.exec(rest)
        : null;
  if (!match) return null;
  const value = Number.parseInt(match[1] ?? match[0], 16);
  if (value > 0x10ffff) return null;
  state.pos += match[0].length;
  return String.fromCodePoint(value);
}

function parseClass(source: string, state: ParseState): RegexPart {
  const negated = source[state.pos] === '^';
  if (negated) state.pos += 1;
  const bodyStart = state.pos;
  // A leading ] is a literal member; escapes never close the class.
  if (source[state.pos] === ']') state.pos += 1;
  while (state.pos < source.length && source[state.pos] !== ']') {
    state.pos += source[state.pos] === '\\' ? 2 : 1;
  }
  const body = source.slice(bodyStart, state.pos);
  state.pos += 1;
  return { kind: 'class', negated, body };
}

function parseGroup(source: string, state: ParseState): RegexPart {
  let role: GroupRole = 'capture';
  let name: string | undefined;
  if (source[state.pos] === '?') {
    const head = source.slice(state.pos, state.pos + 3);
    if (head.startsWith('?:')) {
      role = 'plain';
      state.pos += 2;
    } else if (head.startsWith('?=')) {
      role = 'lookahead';
      state.pos += 2;
    } else if (head.startsWith('?!')) {
      role = 'negativeLookahead';
      state.pos += 2;
    } else if (head === '?<=') {
      role = 'lookbehind';
      state.pos += 3;
    } else if (head === '?<!') {
      role = 'negativeLookbehind';
      state.pos += 3;
    } else if (head.startsWith('?<')) {
      const close = source.indexOf('>', state.pos);
      name = source.slice(state.pos + 2, close);
      role = 'named';
      state.pos = close + 1;
    }
  }
  const index = role === 'capture' || role === 'named' ? (state.group += 1) : undefined;
  const inner = parseSequence(source, state, true);
  state.pos += 1;
  return { kind: 'group', role, inner, ...(index ? { index } : {}), ...(name ? { name } : {}) };
}

function parseQuantifier(source: string, state: ParseState): RegexQuantifier | undefined {
  const char = source[state.pos];
  let quantifier: RegexQuantifier | undefined;
  if (char === '+' || char === '*' || char === '?') {
    state.pos += 1;
    quantifier = {
      kind: char === '+' ? 'oneOrMore' : char === '*' ? 'zeroOrMore' : 'optional',
      lazy: false,
    };
  } else if (char === '{') {
    const match = /^\{(\d+)(,(\d*))?\}/u.exec(source.slice(state.pos));
    if (!match) return undefined;
    state.pos += match[0].length;
    const min = Number(match[1]);
    quantifier =
      match[2] === undefined
        ? { kind: 'exactly', min, lazy: false }
        : match[3] === ''
          ? { kind: 'atLeast', min, lazy: false }
          : { kind: 'between', min, max: Number(match[3]), lazy: false };
  }
  if (quantifier && source[state.pos] === '?') {
    state.pos += 1;
    quantifier.lazy = true;
  }
  return quantifier;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

const K = 'utilities.tool.regex.explain';

/** Plain-language meaning of one token, without its source text. */
export function describeRegexToken(token: RegexToken, t: Translate): string {
  const base = describePart(token.part, t);
  if (!token.quantifier) return base;
  const q = token.quantifier;
  const quantity =
    q.kind === 'exactly' || q.kind === 'atLeast'
      ? t(`${K}.quantifier.${q.kind}`, { min: q.min })
      : q.kind === 'between'
        ? t(`${K}.quantifier.between`, { min: q.min, max: q.max })
        : t(`${K}.quantifier.${q.kind}`);
  const lazy = q.lazy ? ` ${t(`${K}.quantifier.lazy`)}` : '';
  return `${base}, ${quantity}${lazy}`;
}

function describePart(part: RegexPart, t: Translate): string {
  switch (part.kind) {
    case 'literal':
      return t(`${K}.literal`);
    case 'any':
      return t(`${K}.any`);
    case 'escape':
      return t(`${K}.escape.${part.name}`);
    case 'escapedChar':
      return t(`${K}.escapedChar`, { char: part.char });
    case 'codePoint':
      return t(`${K}.codePoint`, { char: part.char });
    case 'control':
      return t(`${K}.control`, { letter: part.letter });
    case 'backref':
      return t(`${K}.backref`, { ref: part.ref });
    case 'property':
      return t(part.negated ? `${K}.notProperty` : `${K}.property`, { name: part.name });
    case 'class':
      return t(part.negated ? `${K}.notClass` : `${K}.class`, { body: part.body });
    case 'start':
      return t(part.multiline ? `${K}.lineStart` : `${K}.start`);
    case 'end':
      return t(part.multiline ? `${K}.lineEnd` : `${K}.end`);
    case 'or':
      return t(`${K}.or`);
    case 'group': {
      const inner = part.inner.map(token => describeRegexToken(token, t)).join(', ');
      if (part.role === 'capture') return `${inner} → ${t(`${K}.group`, { index: part.index })}`;
      if (part.role === 'named') return `${inner} → ${t(`${K}.namedGroup`, { name: part.name })}`;
      if (part.role === 'plain') return inner;
      return t(`${K}.${part.role}`, { inner });
    }
  }
}
