/** A value read back from its printed form: JSON, a Python repr, or a JS object literal. */
export type Literal =
  | { readonly t: 'num'; readonly v: number; readonly raw: string }
  | { readonly t: 'str'; readonly v: string }
  | { readonly t: 'bool'; readonly v: boolean }
  | { readonly t: 'none'; readonly raw: string }
  | { readonly t: 'list'; readonly items: readonly Literal[]; readonly shape: 'list' | 'tuple' | 'set' }
  | { readonly t: 'dict'; readonly entries: ReadonlyArray<{ readonly key: string; readonly value: Literal }> };

const MAX_TEXT = 20_000;
const MAX_DEPTH = 24;
const MAX_NODES = 5_000;

const WORDS: Record<string, Literal> = {
  True: { t: 'bool', v: true },
  False: { t: 'bool', v: false },
  true: { t: 'bool', v: true },
  false: { t: 'bool', v: false },
  None: { t: 'none', raw: 'None' },
  null: { t: 'none', raw: 'null' },
  undefined: { t: 'none', raw: 'undefined' },
  NaN: { t: 'num', v: Number.NaN, raw: 'NaN' },
  nan: { t: 'num', v: Number.NaN, raw: 'nan' },
  Infinity: { t: 'num', v: Number.POSITIVE_INFINITY, raw: 'Infinity' },
  inf: { t: 'num', v: Number.POSITIVE_INFINITY, raw: 'inf' },
};

// Sticky, so each read matches at the cursor without slicing the text.
const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WORD = /-?[A-Za-z_$][\w$]*/y;
const KEY = /-?[\w$.]+/y;
const CLOSER: Record<string, string> = { '[': ']', '(': ')', '{': '}' };

class Reader {
  private index = 0;
  private nodes = 0;

  constructor(private readonly text: string) {}

  read(): Literal | undefined {
    const value = this.value(0);
    this.space();
    return value !== undefined && this.index === this.text.length ? value : undefined;
  }

  private space(): void {
    for (let code = this.text.charCodeAt(this.index); code === 32 || (code >= 9 && code <= 13); code = this.text.charCodeAt(this.index)) {
      this.index += 1;
    }
  }

  private match(pattern: RegExp): string | undefined {
    pattern.lastIndex = this.index;
    return pattern.exec(this.text)?.[0];
  }

  private value(depth: number): Literal | undefined {
    if (depth > MAX_DEPTH || ++this.nodes > MAX_NODES) return undefined;
    this.space();
    const c = this.text[this.index];
    if (c === undefined) return undefined;
    if (c === '"' || c === "'") return this.string(c);
    if (c === '[' || c === '(' || c === '{') return this.collection(c, depth);
    const number = this.match(NUMBER);
    if (number) {
      this.index += number.length;
      return { t: 'num', v: Number(number), raw: number };
    }
    const word = this.match(WORD);
    if (!word) return undefined;
    const negative = word.startsWith('-');
    const known = WORDS[negative ? word.slice(1) : word];
    if (!known || (negative && known.t !== 'num')) return undefined;
    this.index += word.length;
    return negative && known.t === 'num' ? { t: 'num', v: -known.v, raw: word } : known;
  }

  private string(quote: string): Literal | undefined {
    let out = '';
    for (let i = this.index + 1; i < this.text.length; i += 1) {
      // Copy the plain run up to the next quote, backslash or line break in one slice.
      let end = i;
      while (end < this.text.length && !'\\\n'.includes(this.text[end]!) && this.text[end] !== quote) end += 1;
      out += this.text.slice(i, end);
      i = end;
      const c = this.text[i];
      if (c === undefined || c === '\n') return undefined;
      if (c === quote) {
        this.index = i + 1;
        return { t: 'str', v: out };
      }
      const next = this.text[i + 1];
      if (next === undefined) return undefined;
      i += 1;
      if (next === 'n') out += '\n';
      else if (next === 't') out += '\t';
      else if (next === 'r') out += '\r';
      else if (next === 'u' || next === 'x') {
        const width = next === 'u' ? 4 : 2;
        const hex = this.text.slice(i + 1, i + 1 + width);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== width) return undefined;
        out += String.fromCharCode(parseInt(hex, 16));
        i += width;
      } else out += next;
    }
    return undefined;
  }

  private key(): string | undefined {
    this.space();
    const c = this.text[this.index];
    if (c === '"' || c === "'") {
      const key = this.string(c);
      return key?.t === 'str' ? key.v : undefined;
    }
    const match = this.match(KEY);
    if (!match) return undefined;
    this.index += match.length;
    return match;
  }

  private collection(open: string, depth: number): Literal | undefined {
    const close = CLOSER[open]!;
    this.index += 1;
    const items: Literal[] = [];
    const entries: Array<{ key: string; value: Literal }> = [];
    let dict: boolean | undefined = open === '{' ? undefined : false;
    for (;;) {
      this.space();
      if (this.text[this.index] === close) {
        this.index += 1;
        break;
      }
      if (dict !== false) {
        const start = this.index;
        const key = this.key();
        this.space();
        if (key !== undefined && this.text[this.index] === ':') {
          if (dict === undefined) dict = true;
          this.index += 1;
          const value = this.value(depth + 1);
          if (value === undefined) return undefined;
          entries.push({ key, value });
        } else if (dict === true) {
          return undefined;
        } else {
          dict = false;
          this.index = start;
        }
      }
      if (dict === false) {
        const item = this.value(depth + 1);
        if (item === undefined) return undefined;
        items.push(item);
      }
      this.space();
      const next = this.text[this.index];
      if (next === ',') this.index += 1;
      else if (next !== close) return undefined;
    }
    if (dict) return { t: 'dict', entries };
    if (open === '{' && items.length === 0) return { t: 'dict', entries: [] };
    return { t: 'list', items, shape: open === '[' ? 'list' : open === '(' ? 'tuple' : 'set' };
  }
}

/** Reads a printed value, or undefined when the text is not a literal (or too large to read). */
export function readLiteral(text: string): Literal | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TEXT) return undefined;
  return new Reader(trimmed).read();
}
