/** Property lists, XML or binary (bplist00), into plain values. Dates and data come back as null. */

export type PlistValue = string | number | boolean | null | PlistValue[] | { [key: string]: PlistValue };

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) =>
    code.startsWith('#x') || code.startsWith('#X') ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code.toLowerCase()]!
  );

interface Token {
  /** Element name, lower-cased; absent for text. */
  name?: string;
  close?: boolean;
  empty?: boolean;
  text?: string;
  /** CDATA text, taken as written. */
  raw?: boolean;
}

/** Tags and text found with indexOf, so no input can make the scan quadratic. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (let at = 0; at < text.length; ) {
    const open = text.indexOf('<', at);
    if (open !== at) {
      tokens.push({ text: text.slice(at, open < 0 ? text.length : open) });
      if (open < 0) break;
    }
    if (text.startsWith('<![CDATA[', open)) {
      const end = text.indexOf(']]>', open + 9);
      if (end < 0) throw new Error('plist');
      tokens.push({ text: text.slice(open + 9, end), raw: true });
      at = end + 3;
      continue;
    }
    const isComment = text.startsWith('<!--', open);
    const end = isComment ? text.indexOf('-->', open + 4) : text.indexOf('>', open);
    if (end < 0) throw new Error('plist');
    at = end + (isComment ? 3 : 1);
    const inner = text.slice(open + 1, end);
    if (isComment || inner.startsWith('?') || inner.startsWith('!')) continue;
    const close = inner.startsWith('/');
    const name = /^[a-z]+/i.exec(inner.slice(close ? 1 : 0, 33))?.[0];
    if (!name) throw new Error('plist');
    tokens.push({ name: name.toLowerCase(), close, empty: !close && inner.endsWith('/') });
  }
  return tokens;
}

/** A key that would replace the dictionary's prototype is dropped. */
const setKey = (dict: Record<string, PlistValue>, key: string, value: PlistValue) => {
  if (key !== '__proto__') dict[key] = value;
};

function parseXml(text: string): PlistValue | undefined {
  const tokens = tokenize(text);
  let index = tokens.findIndex((token) => token.name === 'plist' && !token.close) + 1;
  if (index === 0) return undefined;
  const skipText = () => {
    while (index < tokens.length && tokens[index]!.text !== undefined) index += 1;
  };
  const value = (): PlistValue => {
    skipText();
    const token = tokens[index++];
    if (!token?.name || token.close) throw new Error('plist');
    const tag = token.name;
    if (token.empty) return tag === 'true' ? true : tag === 'false' ? false : tag === 'array' ? [] : tag === 'dict' ? {} : tag === 'string' ? '' : null;
    if (tag === 'array' || tag === 'dict') {
      const list: PlistValue[] = [];
      const dict: Record<string, PlistValue> = {};
      for (;;) {
        skipText();
        const next = tokens[index];
        if (!next) throw new Error('plist');
        if (next.close && next.name === tag) {
          index += 1;
          return tag === 'array' ? list : dict;
        }
        if (tag === 'array') list.push(value());
        else {
          const key = value();
          if (typeof key !== 'string') throw new Error('plist');
          setKey(dict, key, value());
        }
      }
    }
    let text = '';
    while (tokens[index]?.text !== undefined) {
      const part = tokens[index++]!;
      text += part.raw ? part.text : unescape(part.text!);
    }
    const close = tokens[index++];
    if (!close?.close || close.name !== tag) throw new Error('plist');
    if (tag === 'string' || tag === 'key') return text;
    if (tag === 'integer' || tag === 'real') return Number(text.trim());
    return null;
  };
  return value();
}

function parseBinary(data: Buffer): PlistValue | undefined {
  const trailer = data.subarray(data.length - 32);
  const offsetSize = trailer[6]!;
  const refSize = trailer[7]!;
  const count = Number(trailer.readBigUInt64BE(8));
  const top = Number(trailer.readBigUInt64BE(16));
  const tableAt = Number(trailer.readBigUInt64BE(24));
  if (count > 1_000_000 || tableAt + count * offsetSize > data.length) return undefined;
  const readInt = (at: number, size: number) => (size === 8 ? Number(data.readBigUInt64BE(at)) : data.readUIntBE(at, size));
  const offset = (ref: number) => readInt(tableAt + ref * offsetSize, offsetSize);
  const seen = new Set<number>();
  // An object several containers point at is built once, so shared references cannot multiply the work.
  const built = new Map<number, PlistValue>();
  const object = (ref: number): PlistValue => {
    if (built.has(ref)) return built.get(ref)!;
    if (seen.has(ref) || ref >= count || seen.size > 64) throw new Error('plist');
    seen.add(ref);
    try {
      const value = read(ref);
      built.set(ref, value);
      return value;
    } finally {
      seen.delete(ref);
    }
  };
  const read = (ref: number): PlistValue => {
    let at = offset(ref);
    const marker = data[at]!;
    const kind = marker >> 4;
    let length = marker & 0x0f;
    at += 1;
    if (kind === 0) return marker === 0x09 ? true : marker === 0x08 ? false : null;
    if (kind === 1) return readInt(at, 1 << length);
    if (kind === 2) return length === 3 ? data.readDoubleBE(at) : data.readFloatBE(at);
    if (length === 0x0f && kind >= 4) {
      const size = 1 << (data[at]! & 0x0f);
      length = readInt(at + 1, size);
      at += 1 + size;
    }
    const width = kind === 6 ? 2 : kind === 10 ? refSize : kind === 13 ? refSize * 2 : 1;
    if (at + length * width > data.length) throw new Error('plist');
    if (kind === 5) return data.toString('latin1', at, at + length);
    if (kind === 6) return Buffer.from(data.subarray(at, at + length * 2)).swap16().toString('utf16le');
    if (kind === 10) return Array.from({ length }, (_, i) => object(readInt(at + i * refSize, refSize)));
    if (kind === 13) {
      const dict: Record<string, PlistValue> = {};
      for (let i = 0; i < length; i++) {
        const key = object(readInt(at + i * refSize, refSize));
        if (typeof key === 'string') setKey(dict, key, object(readInt(at + (length + i) * refSize, refSize)));
      }
      return dict;
    }
    return null;
  };
  return object(top);
}

/** The plist in `data`, or undefined when it is neither form. */
export function parsePlist(data: Buffer): PlistValue | undefined {
  try {
    if (data.subarray(0, 8).toString('latin1') === 'bplist00') return data.length > 40 ? parseBinary(data) : undefined;
    return parseXml(data.toString('utf-8'));
  } catch {
    return undefined;
  }
}
