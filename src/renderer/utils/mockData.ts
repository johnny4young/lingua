/**
 * Mock Data Generator — pure, offline, renderer-side.
 *
 * Produces `count` synthetic records for a chosen dataset preset and
 * serializes them to JSON, CSV, or NDJSON. Generation is driven by a
 * small seedable PRNG (mulberry32) so a given `{ dataset, count, seed }`
 * always yields byte-identical output — which makes the panel's "Regenerate"
 * predictable and lets the unit tests assert exact structure.
 *
 * No DOM, no network, no persisted state — safe to call from the Electron
 * renderer, the web build, and vitest's jsdom setup. Deliberately ships no
 * new dependency (a full `faker` would add meaningful bundle weight — see
 * the audit's C-1 finding) — the corpora below are intentionally small.
 */

export type MockDataset = 'users' | 'products' | 'posts';
export type MockFormat = 'json' | 'csv' | 'ndjson';

export interface MockDataOptions {
  dataset: MockDataset;
  /** Clamped to [1, MOCK_DATA_MAX_COUNT]. */
  count: number;
  format: MockFormat;
  /**
   * Optional deterministic seed. When a non-empty string is provided the
   * output is reproducible; when empty the seed is derived from the other
   * options so the same panel state still round-trips within a session.
   */
  seed?: string;
}

export const MOCK_DATA_MAX_COUNT = 1000;

const FIRST_NAMES = [
  'Ada', 'Grace', 'Alan', 'Linus', 'Dennis', 'Barbara', 'Katherine', 'Guido',
  'Margaret', 'Ken', 'Radia', 'Bjarne', 'Anita', 'Tim', 'Hedy', 'Donald',
];
const LAST_NAMES = [
  'Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Ritchie', 'Liskov', 'Johnson',
  'Rossum', 'Hamilton', 'Thompson', 'Perlman', 'Stroustrup', 'Borg', 'Berners-Lee',
];
const DOMAINS = ['example.com', 'test.dev', 'mail.io', 'sandbox.app'];
const PRODUCT_ADJECTIVES = ['Portable', 'Wireless', 'Compact', 'Rugged', 'Smart', 'Eco', 'Pro', 'Mini'];
const PRODUCT_NOUNS = ['Keyboard', 'Monitor', 'Charger', 'Router', 'Speaker', 'Webcam', 'Drive', 'Hub'];
const PRODUCT_CATEGORIES = ['Peripherals', 'Networking', 'Audio', 'Storage', 'Accessories'];
const POST_WORDS = [
  'building', 'scaling', 'debugging', 'testing', 'refactoring', 'shipping',
  'designing', 'measuring', 'the', 'a', 'clean', 'fast', 'resilient', 'system',
  'service', 'pipeline', 'runtime', 'sandbox', 'edge', 'cache',
];

/** mulberry32 — tiny deterministic PRNG. Returns a float in [0, 1). */
function makeRng(seedText: string): () => number {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)] ?? list[0]!;
}

function intBetween(rng: () => number, minInclusive: number, maxInclusive: number): number {
  return Math.floor(rng() * (maxInclusive - minInclusive + 1)) + minInclusive;
}

/** ISO date within the last ~3 years, derived only from the RNG (no `Date.now`). */
function pseudoIsoDate(rng: () => number): string {
  const year = 2023 + intBetween(rng, 0, 2);
  const month = intBetween(rng, 1, 12);
  const day = intBetween(rng, 1, 28);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

type MockRecord = Record<string, string | number | boolean>;

function buildUser(rng: () => number, index: number): MockRecord {
  const first = pick(rng, FIRST_NAMES);
  const last = pick(rng, LAST_NAMES);
  return {
    id: index + 1,
    name: `${first} ${last}`,
    email: `${slugify(first)}.${slugify(last)}@${pick(rng, DOMAINS)}`,
    age: intBetween(rng, 18, 72),
    active: rng() > 0.35,
    createdAt: pseudoIsoDate(rng),
  };
}

function buildProduct(rng: () => number, index: number): MockRecord {
  const name = `${pick(rng, PRODUCT_ADJECTIVES)} ${pick(rng, PRODUCT_NOUNS)}`;
  return {
    id: index + 1,
    sku: `SKU-${String(intBetween(rng, 1000, 9999))}`,
    name,
    category: pick(rng, PRODUCT_CATEGORIES),
    price: Number((rng() * 490 + 10).toFixed(2)),
    inStock: rng() > 0.25,
  };
}

function buildPost(rng: () => number, index: number): MockRecord {
  const length = intBetween(rng, 3, 6);
  const words: string[] = [];
  for (let i = 0; i < length; i += 1) words.push(pick(rng, POST_WORDS));
  const title = words.join(' ').replace(/^\w/, (c) => c.toUpperCase());
  return {
    id: index + 1,
    title,
    slug: slugify(title),
    published: rng() > 0.4,
    views: intBetween(rng, 0, 50000),
    createdAt: pseudoIsoDate(rng),
  };
}

function buildRecord(dataset: MockDataset, rng: () => number, index: number): MockRecord {
  if (dataset === 'products') return buildProduct(rng, index);
  if (dataset === 'posts') return buildPost(rng, index);
  return buildUser(rng, index);
}

function clampCount(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), MOCK_DATA_MAX_COUNT);
}

function csvCell(value: string | number | boolean): string {
  const str = String(value);
  // RFC 4180 quoting: wrap when the cell holds a comma, quote, or newline.
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(records: readonly MockRecord[]): string {
  if (records.length === 0) return '';
  const headers = Object.keys(records[0]!);
  const lines = [headers.join(',')];
  for (const record of records) {
    lines.push(headers.map((h) => csvCell(record[h] ?? '')).join(','));
  }
  return lines.join('\n');
}

/**
 * Generate mock data. Returns the serialized string (never `null`) — an
 * empty count yields an empty string. Pure: no `Date`, no `Math.random`.
 */
export function generateMockData(options: MockDataOptions): string {
  const count = clampCount(options.count);
  if (count === 0) return '';

  const seedText =
    options.seed && options.seed.length > 0
      ? options.seed
      : `${options.dataset}:${count}:${options.format}`;
  const rng = makeRng(seedText);

  const records: MockRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    records.push(buildRecord(options.dataset, rng, i));
  }

  if (options.format === 'csv') return toCsv(records);
  if (options.format === 'ndjson') {
    return records.map((record) => JSON.stringify(record)).join('\n');
  }
  return JSON.stringify(records, null, 2);
}
