import { utf8ByteLength } from '../httpWorkspaceSchema';
import { decompressUriComponentBounded } from './boundedLzString';

export const PLAYGROUND_URL_FLOW_ID = 'playground-url' as const;

export const PLAYGROUND_PROVIDER_IDS = ['typescript-playground', 'go-playground'] as const;
export type PlaygroundProviderId = (typeof PLAYGROUND_PROVIDER_IDS)[number];

export const PLAYGROUND_URL_REJECT_REASONS = [
  'empty-input',
  'url-too-large',
  'invalid-url',
  'unsupported-provider',
  'provider-not-readable',
  'invalid-share-link',
  'decode-failed',
  'source-empty',
  'source-too-large',
  'network-timeout',
  'network-failed',
  'remote-not-found',
  'unexpected-content-type',
  'cancelled',
] as const;
export type PlaygroundUrlRejectReason = (typeof PLAYGROUND_URL_REJECT_REASONS)[number];

export const MAX_PLAYGROUND_URL_CHARS = 64 * 1024;
export const MAX_PLAYGROUND_SOURCE_BYTES = 512 * 1024;
export const PLAYGROUND_FETCH_TIMEOUT_MS = 7_000;

export interface PlaygroundSourcePreview {
  readonly kind: 'playground-source';
  readonly provider: PlaygroundProviderId;
  readonly language: 'javascript' | 'typescript' | 'go';
  readonly title: string;
  readonly source: string;
  readonly sourceBytes: number;
  readonly lineCount: number;
  readonly fetchedRemotely: boolean;
  readonly warnings: readonly [];
}

export type PlaygroundUrlPreviewOutcome =
  | {
      readonly status: 'previewed';
      readonly preview: PlaygroundSourcePreview;
      readonly sourceBytes: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: PlaygroundUrlRejectReason;
      readonly sourceBytes: number;
    }
  | {
      readonly status: 'cancelled';
      readonly sourceBytes: number;
    };

interface PlaygroundUrlLoadOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

type ResolvedPlaygroundSource =
  | {
      readonly kind: 'local';
      readonly provider: 'typescript-playground';
      readonly language: 'javascript' | 'typescript';
      readonly title: string;
      readonly source: string;
    }
  | {
      readonly kind: 'remote';
      readonly provider: 'go-playground';
      readonly language: 'go';
      readonly title: string;
      readonly sourceUrl: string;
    };

type ResolveOutcome =
  | { readonly ok: true; readonly resolved: ResolvedPlaygroundSource }
  | { readonly ok: false; readonly reason: PlaygroundUrlRejectReason };

const TYPESCRIPT_HOSTS = new Set(['typescriptlang.org', 'www.typescriptlang.org']);
const GO_INPUT_HOSTS = new Set(['go.dev', 'www.go.dev', 'play.golang.org']);
const NON_READABLE_PLAYGROUND_HOSTS = new Set([
  'codepen.io',
  'www.codepen.io',
  'jsfiddle.net',
  'www.jsfiddle.net',
]);

/**
 * Resolve only documented, closed playground URL contracts.
 *
 * TypeScript Playground embeds source in the fragment and is decoded locally.
 * Go Playground shares an opaque id; only that id crosses the network and it
 * is expanded to the official fixed-origin raw-text endpoint. No caller-owned
 * hostname, path, query, credentials, or redirect target is ever fetched.
 */
export function resolvePlaygroundUrl(input: string): ResolveOutcome {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'empty-input' };
  if (raw.length > MAX_PLAYGROUND_URL_CHARS) {
    return { ok: false, reason: 'url-too-large' };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return { ok: false, reason: 'invalid-url' };
  }

  const host = url.hostname.toLowerCase();
  if (NON_READABLE_PLAYGROUND_HOSTS.has(host)) {
    return { ok: false, reason: 'provider-not-readable' };
  }
  if (TYPESCRIPT_HOSTS.has(host)) return resolveTypeScriptPlayground(url);
  if (GO_INPUT_HOSTS.has(host)) return resolveGoPlayground(url);
  return { ok: false, reason: 'unsupported-provider' };
}

export async function loadPlaygroundUrlPreview(
  input: string,
  options: PlaygroundUrlLoadOptions = {}
): Promise<PlaygroundUrlPreviewOutcome> {
  const inputBytes = utf8ByteLength(input);
  const resolution = resolvePlaygroundUrl(input);
  if (!resolution.ok) {
    return {
      status: 'rejected',
      reason: resolution.reason,
      sourceBytes: inputBytes,
    };
  }

  const { resolved } = resolution;
  if (resolved.kind === 'local') {
    return previewResolvedSource(resolved, false, inputBytes);
  }

  if (options.signal?.aborted) {
    return { status: 'cancelled', sourceBytes: inputBytes };
  }

  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    options.timeoutMs ?? PLAYGROUND_FETCH_TIMEOUT_MS
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await (options.fetchImpl ?? fetch)(resolved.sourceUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'text/plain' },
      signal,
    });
    if (response.status === 404) {
      return {
        status: 'rejected',
        reason: 'remote-not-found',
        sourceBytes: inputBytes,
      };
    }
    if (!response.ok) {
      return {
        status: 'rejected',
        reason: 'network-failed',
        sourceBytes: inputBytes,
      };
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('text/plain')) {
      return {
        status: 'rejected',
        reason: 'unexpected-content-type',
        sourceBytes: inputBytes,
      };
    }
    const declaredLength = parseContentLength(response.headers.get('content-length'));
    if (declaredLength !== null && declaredLength > MAX_PLAYGROUND_SOURCE_BYTES) {
      return {
        status: 'rejected',
        reason: 'source-too-large',
        sourceBytes: declaredLength,
      };
    }

    const sourceResult = await readBoundedText(response);
    if (!sourceResult.ok) {
      return {
        status: 'rejected',
        reason: 'source-too-large',
        sourceBytes: sourceResult.sourceBytes,
      };
    }
    return previewResolvedSource(
      { ...resolved, source: sourceResult.source },
      true,
      sourceResult.sourceBytes
    );
  } catch {
    if (options.signal?.aborted) {
      return { status: 'cancelled', sourceBytes: inputBytes };
    }
    return {
      status: 'rejected',
      reason: timeoutController.signal.aborted ? 'network-timeout' : 'network-failed',
      sourceBytes: inputBytes,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveTypeScriptPlayground(url: URL): ResolveOutcome {
  if (!['/play', '/play/', '/play/index.html'].includes(url.pathname)) {
    return { ok: false, reason: 'invalid-share-link' };
  }
  const hash = url.hash;
  let source: string | null = null;
  try {
    if (hash.startsWith('#code/')) {
      const decoded = decompressUriComponentBounded(
        hash.slice('#code/'.length),
        MAX_PLAYGROUND_SOURCE_BYTES
      );
      if (decoded.status === 'too-large') return { ok: false, reason: 'source-too-large' };
      if (decoded.status === 'invalid') return { ok: false, reason: 'decode-failed' };
      source = decoded.value;
    } else if (hash.startsWith('#src=')) {
      source = decodeURIComponent(hash.slice('#src='.length));
    }
  } catch {
    return { ok: false, reason: 'decode-failed' };
  }
  if (source === null) return { ok: false, reason: 'invalid-share-link' };

  const language =
    url.searchParams.get('filetype') === 'js' || url.searchParams.get('useJavaScript') === 'true'
      ? 'javascript'
      : 'typescript';
  return {
    ok: true,
    resolved: {
      kind: 'local',
      provider: 'typescript-playground',
      language,
      title: `typescript-playground.${language === 'javascript' ? 'js' : 'ts'}`,
      source,
    },
  };
}

function resolveGoPlayground(url: URL): ResolveOutcome {
  if (url.hash !== '' || [...url.searchParams].length > 0) {
    return { ok: false, reason: 'invalid-share-link' };
  }
  const host = url.hostname.toLowerCase();
  const pathPattern = host === 'play.golang.org' ? /^\/p\/([^/]+)$/u : /^\/play\/p\/([^/]+)$/u;
  const match = pathPattern.exec(url.pathname);
  const rawId = match?.[1]?.endsWith('.go') ? match[1].slice(0, -'.go'.length) : match?.[1];
  if (!rawId || !/^[A-Za-z0-9_-]{1,64}$/u.test(rawId)) {
    return { ok: false, reason: 'invalid-share-link' };
  }
  return {
    ok: true,
    resolved: {
      kind: 'remote',
      provider: 'go-playground',
      language: 'go',
      title: `go-playground-${rawId}.go`,
      sourceUrl: `https://play.golang.org/p/${rawId}.go`,
    },
  };
}

function previewResolvedSource(
  resolved: Omit<ResolvedPlaygroundSource, 'kind' | 'sourceUrl'> & {
    readonly source: string;
  },
  fetchedRemotely: boolean,
  fallbackBytes: number
): PlaygroundUrlPreviewOutcome {
  const sourceBytes = utf8ByteLength(resolved.source);
  if (resolved.source.trim().length === 0) {
    return { status: 'rejected', reason: 'source-empty', sourceBytes: fallbackBytes };
  }
  if (sourceBytes > MAX_PLAYGROUND_SOURCE_BYTES) {
    return { status: 'rejected', reason: 'source-too-large', sourceBytes };
  }
  return {
    status: 'previewed',
    sourceBytes,
    preview: {
      kind: 'playground-source',
      provider: resolved.provider,
      language: resolved.language,
      title: resolved.title,
      source: resolved.source,
      sourceBytes,
      lineCount: resolved.source.split(/\r\n|\r|\n/u).length,
      fetchedRemotely,
      warnings: [],
    },
  };
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readBoundedText(
  response: Response
): Promise<
  | { readonly ok: true; readonly source: string; readonly sourceBytes: number }
  | { readonly ok: false; readonly sourceBytes: number }
> {
  if (!response.body) {
    const source = await response.text();
    const sourceBytes = utf8ByteLength(source);
    return sourceBytes <= MAX_PLAYGROUND_SOURCE_BYTES
      ? { ok: true, source, sourceBytes }
      : { ok: false, sourceBytes };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let source = '';
  let sourceBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sourceBytes += value.byteLength;
      if (sourceBytes > MAX_PLAYGROUND_SOURCE_BYTES) {
        await reader.cancel();
        return { ok: false, sourceBytes };
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
    return { ok: true, source, sourceBytes };
  } finally {
    reader.releaseLock();
  }
}
