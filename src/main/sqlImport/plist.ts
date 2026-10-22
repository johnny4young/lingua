/** Property lists, XML or binary (bplist00), into plain values. Dates and data come back as null. */

export type PlistValue = string | number | boolean | null | PlistValue[] | { [key: string]: PlistValue };

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

const unescape = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code: string) =>
    code.startsWith('#x') || code.startsWith('#X') ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : ENTITIES[code.toLowerCase()]!
  );

function parseXml(text: string): PlistValue | undefined {
  const tokens = [...text.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z]+)(?:\s[^>]*?)?\s*(\/?)>|([^<]+)/gi)];
  let index = tokens.findIndex((token) => token[2] === 'plist' && !token[1]) + 1;
  if (index === 0) return undefined;
  const skipText = () => {
    while (index < tokens.length && tokens[index]![4] !== undefined) index += 1;
  };
  const value = (): PlistValue => {
    skipText();
    const token = tokens[index++];
    if (!token || token[1] || !token[2]) throw new Error('plist');
    const tag = token[2];
    if (token[3]) return tag === 'true' ? true : tag === 'false' ? false : tag === 'array' ? [] : tag === 'dict' ? {} : tag === 'string' ? '' : null;
    if (tag === 'array' || tag === 'dict') {
      const list: PlistValue[] = [];
      const dict: Record<string, PlistValue> = {};
      for (;;) {
        skipText();
        const next = tokens[index];
        if (!next) throw new Error('plist');
        if (next[1] && next[2] === tag) {
          index += 1;
          return tag === 'array' ? list : dict;
        }
        if (tag === 'array') list.push(value());
        else {
          const key = value();
          if (typeof key !== 'string') throw new Error('plist');
          dict[key] = value();
        }
      }
    }
    let content = '';
    while (tokens[index] && tokens[index]![4] !== undefined) content += tokens[index++]![4];
    const close = tokens[index++];
    if (!close || !close[1] || close[2] !== tag) throw new Error('plist');
    const text = unescape(content);
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
  const object = (ref: number): PlistValue => {
    if (seen.has(ref) || ref >= count) throw new Error('plist');
    seen.add(ref);
    try {
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
      if (kind === 5) return data.toString('latin1', at, at + length);
      if (kind === 6) return Buffer.from(data.subarray(at, at + length * 2)).swap16().toString('utf16le');
      if (kind === 10) return Array.from({ length }, (_, i) => object(readInt(at + i * refSize, refSize)));
      if (kind === 13) {
        const dict: Record<string, PlistValue> = {};
        for (let i = 0; i < length; i++) {
          const key = object(readInt(at + i * refSize, refSize));
          if (typeof key === 'string') dict[key] = object(readInt(at + (length + i) * refSize, refSize));
        }
        return dict;
      }
      return null;
    } finally {
      seen.delete(ref);
    }
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
