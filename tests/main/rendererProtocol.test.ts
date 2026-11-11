import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  createRendererProtocolHandler,
  registerRendererScheme,
  RENDERER_BLANK_URL,
  RENDERER_ENTRY_URL,
  RENDERER_SCHEME,
  resolveRendererAssetPath,
} from '../../src/main/rendererProtocol';
import { DESKTOP_RENDERER_ORIGIN } from '../../src/shared/desktopRendererOrigin';

const root = path.resolve('/opt/lingua/renderer/main_window');

describe('renderer scheme', () => {
  it('registers one standard, secure scheme with the V8 code cache and no CSP bypass', () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerRendererScheme({ registerSchemesAsPrivileged });
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([RENDERER_SCHEME]);
    expect(RENDERER_SCHEME).toEqual({
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    });
    expect(RENDERER_ENTRY_URL).toBe('app://lingua/index.html');
  });

  it('stays an origin the license server accepts for released builds that post trials from the renderer', () => {
    const toml = readFileSync(path.resolve(__dirname, '../../license-server/wrangler.toml'), 'utf8');
    const allowed = /^\s*CORS_ALLOWED_ORIGINS\s*=\s*"([^"]*)"/mu.exec(toml)?.[1]?.split(',') ?? [];
    expect(allowed.map(origin => origin.trim())).toContain(DESKTOP_RENDERER_ORIGIN);
  });
});

describe('resolveRendererAssetPath', () => {
  it.each([
    ['app://lingua/index.html', 'index.html'],
    ['app://lingua/', 'index.html'],
    ['app://lingua/assets/main-abc.js?v=1#x', 'assets/main-abc.js'],
    ['app://lingua/pyodide/pyodide%20asm.wasm', 'pyodide/pyodide asm.wasm'],
    ['app://lingua/..vendor.js', '..vendor.js'],
    // The URL parser removes dot segments, encoded ones included, before the handler sees them.
    ['app://lingua/../../etc/passwd', 'etc/passwd'],
    ['app://lingua/%2e%2e/%2e%2e/secret', 'secret'],
  ])('maps %s inside the renderer root', (url, relative) => {
    expect(resolveRendererAssetPath(root, url)).toBe(path.join(root, relative));
  });

  it.each([
    ['posix', path.posix, '/opt/lingua/renderer'],
    ['win32', path.win32, 'C:\\Program Files\\Lingua\\renderer'],
  ] as const)('never leaves the root with %s separators', (_name, pathApi, base) => {
    for (const url of [
      'app://lingua/assets/..%2F..%2F..%2Fsecret',
      'app://lingua/assets/..%5C..%5C..%5Csecret',
      'app://lingua/%5C%5Cserver%5Cshare%5Cx',
      'app://lingua/C:%5CWindows%5Cwin.ini',
    ]) {
      const resolved = resolveRendererAssetPath(base, url, pathApi);
      if (resolved !== null) expect(resolved.startsWith(base + pathApi.sep)).toBe(true);
    }
    expect(resolveRendererAssetPath(base, 'app://lingua/assets/..%2F..%2Fsecret', pathApi)).toBeNull();
  });

  it.each([
    'app://lingua/a%00.js',
    'app://lingua/%E0%A4%A',
    'app://lingua/.lingua/blank.html',
    'app://other/index.html',
    'app://user:pass@lingua/index.html',
    'lingua://app/index.html',
    'file:///opt/lingua/renderer/main_window/index.html',
    'not a url',
  ])('refuses %s', url => {
    expect(resolveRendererAssetPath(root, url)).toBeNull();
  });
});

describe('renderer protocol handler', () => {
  const ok = new Response('body');
  const handler = (fetch = vi.fn(async (_url: string) => ok), isFile = async () => true) => ({
    fetch,
    handle: createRendererProtocolHandler({ net: { fetch }, rendererRoot: root, isFile }),
  });

  it('serves renderer files through a file fetch of the resolved path', async () => {
    const { fetch, handle } = handler();
    await expect(handle(new Request('app://lingua/assets/main.js'))).resolves.toBe(ok);
    expect(fetch).toHaveBeenCalledWith(pathToFileURL(path.join(root, 'assets/main.js')).href);
  });

  it('answers a missing file with a network error, so the load fails instead of rendering', async () => {
    const { handle } = handler(
      vi.fn(async () => {
        throw new Error('net::ERR_FILE_NOT_FOUND');
      })
    );
    const response = await handle(new Request(RENDERER_ENTRY_URL));
    expect(response.type).toBe('error');
  });

  it('never hands a directory or a missing path to the file loader', async () => {
    const fetch = vi.fn(async () => ok);
    const { handle } = handler(fetch, async () => false);
    for (const url of ['app://lingua/assets/', 'app://lingua/missing.js']) {
      expect((await handle(new Request(url))).type).toBe('error');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks a real path with the default file test', async () => {
    const fetch = vi.fn(async () => ok);
    const handle = createRendererProtocolHandler({ net: { fetch }, rendererRoot: __dirname });
    expect((await handle(new Request('app://lingua/'))).type).toBe('error');
    await expect(handle(new Request(`app://lingua/${path.basename(__filename)}`))).resolves.toBe(ok);
  });

  it('answers traversal and foreign hosts with 404 without touching disk', async () => {
    const { fetch, handle } = handler();
    for (const url of ['app://lingua/a%2F..%2F..%2Fx', 'app://other/index.html']) {
      expect((await handle(new Request(url))).status).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses methods other than GET and HEAD', async () => {
    const { fetch, handle } = handler();
    const response = await handle(new Request(RENDERER_ENTRY_URL, { method: 'POST', body: 'x' }));
    expect(response.status).toBe(405);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('serves an empty, script-free document for main-driven storage work', async () => {
    const { fetch, handle } = handler();
    const response = await handle(new Request(RENDERER_BLANK_URL));
    expect(response.headers.get('content-type')).toBe('text/html');
    const html = await response.text();
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<script');
    expect(fetch).not.toHaveBeenCalled();
  });
});
