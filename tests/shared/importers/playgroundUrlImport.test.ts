import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it, vi } from 'vitest';
import {
  loadPlaygroundUrlPreview,
  MAX_PLAYGROUND_SOURCE_BYTES,
  MAX_PLAYGROUND_URL_CHARS,
  resolvePlaygroundUrl,
} from '../../../src/shared/importers/playgroundUrlImport';

describe('playground URL resolution', () => {
  it('decodes TypeScript Playground source locally', async () => {
    const source = 'const answer: number = 42;\nconsole.log(answer);';
    const encoded = compressToEncodedURIComponent(source);
    const fetchImpl = vi.fn<typeof fetch>();

    const outcome = await loadPlaygroundUrlPreview(
      `https://www.typescriptlang.org/play/?ts=next#code/${encoded}`,
      { fetchImpl }
    );

    expect(outcome).toMatchObject({
      status: 'previewed',
      preview: {
        provider: 'typescript-playground',
        language: 'typescript',
        source,
        fetchedRemotely: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('supports the documented legacy src fragment and JavaScript mode', async () => {
    const outcome = await loadPlaygroundUrlPreview(
      'https://typescriptlang.org/play/?filetype=js#src=console.log(%22hello%22)'
    );
    expect(outcome).toMatchObject({
      status: 'previewed',
      preview: {
        language: 'javascript',
        source: 'console.log("hello")',
        title: 'typescript-playground.js',
      },
    });
  });

  it.each([
    'const greeting = "¡Hola, 世界! 👋";',
    'x'.repeat(32_768),
    Array.from({ length: 2_000 }, (_, index) => `value_${index % 97}`).join('|'),
  ])('matches lz-string for bounded valid source %#', async source => {
    const encoded = compressToEncodedURIComponent(source);
    await expect(
      loadPlaygroundUrlPreview(`https://www.typescriptlang.org/play/#code/${encoded}`)
    ).resolves.toMatchObject({
      status: 'previewed',
      preview: { source },
    });
  });

  it.each([
    ['', 'empty-input'],
    [`https://go.dev/play/p/${'a'.repeat(MAX_PLAYGROUND_URL_CHARS)}`, 'url-too-large'],
    ['not a URL', 'invalid-url'],
    ['http://go.dev/play/p/abc', 'invalid-url'],
    ['https://user@go.dev/play/p/abc', 'invalid-url'],
    ['https://go.dev:444/play/p/abc', 'invalid-url'],
    ['https://example.com/play/p/abc', 'unsupported-provider'],
    ['https://codepen.io/user/pen/abc', 'provider-not-readable'],
    ['https://jsfiddle.net/user/abc/', 'provider-not-readable'],
    ['https://www.typescriptlang.org/docs/#code/abc', 'invalid-share-link'],
    ['https://go.dev/play/p/abc?target=elsewhere', 'invalid-share-link'],
    ['https://go.dev/play/p/../secret', 'invalid-share-link'],
  ])('rejects %j as %s', (sourceUrl, reason) => {
    expect(resolvePlaygroundUrl(sourceUrl)).toEqual({ ok: false, reason });
  });

  it('rejects malformed and oversized embedded TypeScript source', async () => {
    await expect(
      loadPlaygroundUrlPreview('https://www.typescriptlang.org/play/#code/not-valid')
    ).resolves.toMatchObject({ status: 'rejected', reason: 'decode-failed' });

    const encoded = compressToEncodedURIComponent('x'.repeat(MAX_PLAYGROUND_SOURCE_BYTES + 1));
    await expect(
      loadPlaygroundUrlPreview(`https://www.typescriptlang.org/play/#code/${encoded}`)
    ).resolves.toMatchObject({ status: 'rejected', reason: 'source-too-large' });
  });
});

describe('Go Playground network boundary', () => {
  it('fetches only the fixed official raw endpoint with privacy-safe options', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('package main\n\nfunc main() {}\n', {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    );

    const outcome = await loadPlaygroundUrlPreview('https://go.dev/play/p/a_B-c123', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://play.golang.org/p/a_B-c123.go');
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'text/plain' },
    });
    expect(outcome).toMatchObject({
      status: 'previewed',
      preview: {
        provider: 'go-playground',
        language: 'go',
        fetchedRemotely: true,
        title: 'go-playground-a_B-c123.go',
      },
    });
  });

  it.each([
    [404, 'remote-not-found'],
    [429, 'network-failed'],
  ])('maps HTTP %i to %s', async (status, reason) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
    await expect(
      loadPlaygroundUrlPreview('https://go.dev/play/p/abc', { fetchImpl })
    ).resolves.toMatchObject({ status: 'rejected', reason });
  });

  it('requires plain text and rejects a declared oversized body before reading', async () => {
    const htmlFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html></html>', {
        headers: { 'content-type': 'text/html' },
      })
    );
    await expect(
      loadPlaygroundUrlPreview('https://go.dev/play/p/abc', {
        fetchImpl: htmlFetch,
      })
    ).resolves.toMatchObject({
      status: 'rejected',
      reason: 'unexpected-content-type',
    });

    const oversizedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('not read', {
        headers: {
          'content-type': 'text/plain',
          'content-length': String(MAX_PLAYGROUND_SOURCE_BYTES + 1),
        },
      })
    );
    await expect(
      loadPlaygroundUrlPreview('https://go.dev/play/p/abc', {
        fetchImpl: oversizedFetch,
      })
    ).resolves.toMatchObject({
      status: 'rejected',
      reason: 'source-too-large',
    });
  });

  it('enforces the byte cap while streaming even without Content-Length', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PLAYGROUND_SOURCE_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/plain' } }));
    await expect(
      loadPlaygroundUrlPreview('https://go.dev/play/p/abc', { fetchImpl })
    ).resolves.toMatchObject({ status: 'rejected', reason: 'source-too-large' });
  });

  it('distinguishes timeout from user cancellation', async () => {
    const waitForAbort = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    await expect(
      loadPlaygroundUrlPreview('https://go.dev/play/p/abc', {
        fetchImpl: waitForAbort,
        timeoutMs: 1,
      })
    ).resolves.toMatchObject({ status: 'rejected', reason: 'network-timeout' });

    const controller = new AbortController();
    const cancelled = loadPlaygroundUrlPreview('https://go.dev/play/p/abc', {
      fetchImpl: waitForAbort,
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({ status: 'cancelled' });
  });
});
