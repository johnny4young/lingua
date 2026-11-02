/**
 * A utility pipeline as a JavaScript snippet: each step a short block that
 * transforms `value`. Only the recipe travels, never the pipeline's input, which
 * can hold a token. A utility too long to read as a snippet stays a comment.
 */

import { quoted } from './generatedJs';
import { getAdapter } from './utilities/registry';
import type { UtilityAdapterId } from './utilities/types';
import type { PipelineStepV1 } from './utilityPipeline';

type Options = Record<string, unknown>;

const lines = (...parts: string[]) => parts;

const STRING_CASE_JOIN: Readonly<Record<string, string>> = {
  lower: 'tokens.join(" ")',
  upper: 'tokens.join(" ").toUpperCase()',
  title: 'tokens.map(capitalize).join(" ")',
  camel: 'tokens.map((token, index) => (index === 0 ? token : capitalize(token))).join("")',
  snake: 'tokens.join("_")',
  kebab: 'tokens.join("-")',
};
const RADIX_PREFIX: Readonly<Record<string, string>> = { '2': '0b', '8': '0o', '16': '0x' };

const TEMPLATES: Partial<Record<UtilityAdapterId, (options: Options) => string[]>> = {
  'json-format': ({ indent }) => {
    const spaces = indent === 'minified' ? '' : `, null, ${Number(indent)}`;
    return lines(`value = value.trim() === "" ? "" : JSON.stringify(JSON.parse(value)${spaces});`);
  },
  'json-minify': () => lines('value = JSON.stringify(JSON.parse(value));'),
  'base64-encode': () => lines('value = btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(""));'),
  'base64-decode': () => lines('value = new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\\s+/gu, "")), (char) => char.charCodeAt(0)));'),
  'url-encode': () => lines('value = encodeURIComponent(value);'),
  'url-decode': () => lines('value = decodeURIComponent(value);'),
  'jwt-decode': () =>
    lines(
      'const decode = (part) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")), (char) => char.charCodeAt(0))));',
      'const [header, payload] = value.trim().split(".");',
      'value = JSON.stringify({ header: decode(header), payload: decode(payload) }, null, 2);'
    ),
  'url-parse': () =>
    lines(
      'if (value.trim() !== "") {',
      '  const { href, protocol, host, hostname, port, pathname, search, hash, username, password, origin, searchParams: query } = new URL(value.trim());',
      '  const searchParams = Object.create(null);',
      '  for (const key of new Set(query.keys())) {',
      '    const all = query.getAll(key);',
      '    searchParams[key] = all.length === 1 ? all[0] : all;',
      '  }',
      '  value = JSON.stringify({ href, protocol, host, hostname, port, pathname, search, hash, username, password, origin, searchParams }, null, 2);',
      '} else {',
      '  value = "";',
      '}'
    ),
  'regex-replace': ({ pattern, flags, replacement }) =>
    pattern === '' ? [] : lines(`value = value.replace(new RegExp(${quoted(String(pattern))}, ${quoted(String(flags))}), ${quoted(String(replacement))});`),
  hash: ({ algorithm }) =>
    lines(
      `const digest = await crypto.subtle.digest(${quoted(String(algorithm))}, new TextEncoder().encode(value));`,
      'value = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");'
    ),
  timestamp: () =>
    lines(
      'const text = value.trim();',
      'const ms = /^-?\\d+$/u.test(text) ? Number(text) * (text.replace(/^-/u, "").length <= 11 ? 1000 : 1) : Date.parse(text);',
      'value = [`ISO 8601: ${new Date(ms).toISOString()}`, `Epoch ms: ${ms}`, `Epoch s:  ${Math.floor(ms / 1000)}`].join("\\n");'
    ),
  'string-case': ({ target }) =>
    lines(
      'const capitalize = (word) => word[0].toUpperCase() + word.slice(1);',
      'const tokens = value.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").replace(/[_\\-/.]+/gu, " ").trim().split(/\\s+/u).filter(Boolean).map((token) => token.toLowerCase());',
      `value = ${STRING_CASE_JOIN[String(target)] ?? STRING_CASE_JOIN['lower']!};`
    ),
  'html-entity-encode': () =>
    lines(`value = value.replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);`),
  'html-entity-decode': () =>
    lines(
      `const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\\u00a0", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–" };`,
      'value = value.replace(/&(#(?:[0-9]+|x[0-9a-fA-F]+|X[0-9a-fA-F]+)|[a-zA-Z][a-zA-Z0-9]*);/gu, (match, body) => {',
      '  if (body[0] !== "#") return Object.hasOwn(named, body) ? named[body] : match;',
      '  const point = /^#x/iu.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);',
      '  return point <= 0x10ffff ? String.fromCodePoint(point) : match;',
      '});'
    ),
  'number-base': ({ from, to, prefixOutput }) => {
    const target = Number(to);
    const prefix = prefixOutput === true ? (RADIX_PREFIX[String(to)] ?? '') : '';
    const base = from === 'auto' ? '{ "0b": 2, "0o": 8, "0x": 16 }[body.slice(0, 2)] ?? 10' : String(Number(from));
    return lines(
      'const prefixes = { 2: "0b", 8: "0o", 10: "", 16: "0x" };',
      'const allowed = { 2: /^[01]+$/u, 8: /^[0-7]+$/u, 10: /^[0-9]+$/u, 16: /^[0-9a-f]+$/u };',
      'const raw = value.trim().toLowerCase();',
      'const body = raw.replace(/^[+-]/u, "");',
      `const base = ${base};`,
      'const digits = body.slice(body.startsWith(prefixes[base]) ? prefixes[base].length : 0).replace(/_/gu, "");',
      'if (!allowed[base].test(digits)) throw new Error(`not a base-${base} integer`);',
      'const number = BigInt(prefixes[base] + digits);',
      `const text = (raw.startsWith("-") ? -number : number).toString(${target});`,
      `value = text.startsWith("-") ? "-" + ${quoted(prefix)} + text.slice(1) : ${quoted(prefix)} + text;`
    );
  },
  'line-sort': ({ direction, caseInsensitive, unique, numeric }) =>
    lines(
      'const text = value.replace(/\\r\\n?|\\n/gu, "\\n");',
      'const trailing = text.endsWith("\\n");',
      'let rows = text.split("\\n");',
      'if (trailing) rows.pop();',
      `const keyOf = (row) => ${caseInsensitive === true ? 'row.toLowerCase()' : 'row'};`,
      ...(unique === true ? ['const seen = new Set();', 'rows = rows.filter((row) => !seen.has(keyOf(row)) && seen.add(keyOf(row)));'] : []),
      `rows.sort((a, b) => ${direction === 'desc' ? '-' : ''}(${numeric === true ? 'keyOf(a).localeCompare(keyOf(b), "en", { numeric: true })' : 'keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0'}));`,
      'value = rows.join("\\n") + (trailing ? "\\n" : "");'
    ),
  slugify: ({ separator, lowercase }) => {
    const sep = quoted(separator === 'underscore' ? '_' : '-');
    return lines(`value = value.normalize("NFKD").replace(/[\\u0300-\\u036f]/gu, "").replace(/[^a-zA-Z0-9]+/gu, ${sep}).replace(/^[-_]+|[-_]+$/gu, "")${lowercase === false ? '' : '.toLowerCase()'};`);
  },
  'text-stats': () =>
    lines(
      'const count = value === "" ? 0 : value.split(/\\r\\n|\\r|\\n/u).length;',
      'const words = value.trim() === "" ? 0 : value.trim().split(/\\s+/u).length;',
      'value = [`Lines: ${count}`, `Words: ${words}`, `Characters: ${[...value].length}`, `Bytes: ${new TextEncoder().encode(value).length}`].join("\\n");'
    ),
};

export interface PipelineJsLabels {
  /** The comment above the input, in the user's language. */
  input: string;
  title: (utilityId: UtilityAdapterId) => string;
  /** The comment for a step with no short form. */
  skipped: (title: string) => string;
}

const comment = (text: string) => `// ${text.replace(/\s+/g, ' ')}`;

export function buildPipelineJs(steps: ReadonlyArray<PipelineStepV1>, labels: PipelineJsLabels): string {
  const blocks = steps.map((step, index) => {
    const title = labels.title(step.utilityId);
    const template = TEMPLATES[step.utilityId];
    if (!template) return comment(`${index + 1}. ${labels.skipped(title)}`);
    const adapter = getAdapter(step.utilityId);
    const options = (adapter?.parseOptions(step.options) ?? adapter?.defaultOptions() ?? {}) as Options;
    const body = template(options);
    // A block keeps one step's names from colliding with the next one's.
    return [comment(`${index + 1}. ${title}`), '{', ...body.map((line) => `  ${line}`), '}'].join('\n');
  });
  return [comment(labels.input), 'let value = "";', '', ...blocks.flatMap((block) => [block, '']), 'console.log(value);', ''].join('\n');
}
