/**
 * The JSON tree model behind the response Body view: node identities,
 * capture paths, search hits and the documents big enough to start folded.
 */

import type { HttpCaptureRule } from '../../../shared/httpWorkspaceSchema';

export type JsonSegment = string | number;

/** RFC 6901 pointer for a node, used as its identity. */
export function jsonPointer(segments: readonly JsonSegment[]): string {
  return segments.map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('');
}

export function parseJsonBody(raw: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return null;
  }
}

/**
 * The Capture path for a node (`items[0].id`), or null when a key cannot be
 * written in one: the capture walker splits on dots and trims every key.
 */
export function capturePath(segments: readonly JsonSegment[]): string | null {
  if (segments.length === 0) return null;
  let path = '';
  for (const segment of segments) {
    if (typeof segment === 'number') {
      path += `[${segment}]`;
      continue;
    }
    if (segment.length === 0 || segment !== segment.trim() || /[.[\]]/.test(segment)) return null;
    path += path.length > 0 ? `.${segment}` : segment;
  }
  return path;
}

/** A capture path in the one form the walker reads it, so `items[0].id` and `items.0.id` compare equal. */
export function normalizeCapturePath(path: string): string {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .join('.');
}

/** Normalized path → variable, for the enabled body rules that name one. */
export function capturedByPath(rules: readonly HttpCaptureRule[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of rules ?? []) {
    const target = rule.targetVariable.trim();
    if (rule.enabled && rule.source === 'body-json' && target.length > 0) map.set(normalizeCapturePath(rule.path), target);
  }
  return map;
}

/** A variable name for a captured node: its last key, made safe and unique among `taken`. */
export function suggestCaptureName(segments: readonly JsonSegment[], taken: ReadonlySet<string>): string {
  const key = [...segments].reverse().find((segment): segment is string => typeof segment === 'string');
  const base = (key ?? 'value').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'value';
  let name = base;
  for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}_${suffix}`;
  return name;
}

/** How a primitive reads in the tree: strings quoted and escaped, the rest as JSON writes them. */
export function primitiveText(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] => value !== null && typeof value === 'object';

/** Nodes in the document, counted up to `cap`. */
export function countJsonNodes(value: unknown, cap: number): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0 && count < cap) {
    const node = stack.pop();
    count += 1;
    if (isContainer(node)) for (const child of Object.values(node)) stack.push(child);
  }
  return count;
}

function occurrences(text: string, query: string): number {
  let count = 0;
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + query.length)) count += 1;
  return count;
}

export interface JsonSearch {
  /** Matches across keys and values, as the tree shows them. */
  count: number;
  /** Pointers of the nodes holding a match. */
  hits: ReadonlySet<string>;
  /** Pointers of every container on the way to a match, opened while searching. */
  open: ReadonlySet<string>;
}

const NO_SEARCH: JsonSearch = { count: 0, hits: new Set(), open: new Set() };

/** Case-insensitive search over keys and values; it stops counting at `limit`. */
export function searchJson(value: unknown, query: string, limit = 10_000): JsonSearch {
  const needle = query.toLowerCase();
  if (needle.length === 0) return NO_SEARCH;
  let count = 0;
  const hits = new Set<string>();
  const open = new Set<string>();
  const stack: Array<{ node: unknown; segments: JsonSegment[] }> = [{ node: value, segments: [] }];
  while (stack.length > 0 && count < limit) {
    const { node, segments } = stack.pop()!;
    const last = segments[segments.length - 1];
    let found = typeof last === 'string' ? occurrences(last.toLowerCase(), needle) : 0;
    if (!isContainer(node)) found += occurrences(primitiveText(node).toLowerCase(), needle);
    if (found > 0) {
      count += found;
      hits.add(jsonPointer(segments));
      for (let depth = 0; depth < segments.length; depth += 1) open.add(jsonPointer(segments.slice(0, depth)));
    }
    if (isContainer(node)) {
      const entries = Array.isArray(node) ? node.map((child, index) => [index, child] as const) : Object.entries(node);
      for (const [key, child] of entries) stack.push({ node: child, segments: [...segments, key] });
    }
  }
  return { count: Math.min(count, limit), hits, open };
}
