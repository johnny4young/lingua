import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CustomScheme } from 'electron';
import {
  DESKTOP_RENDERER_HOST,
  DESKTOP_RENDERER_ORIGIN,
  DESKTOP_RENDERER_SCHEME,
} from '../shared/desktopRendererOrigin';
import { workerScriptCsp } from './workerCsp';

export const RENDERER_ENTRY_URL = `${DESKTOP_RENDERER_ORIGIN}/index.html`;

// No renderer file lives under this prefix; it names documents main serves itself.
const INTERNAL_PREFIX = '/.lingua/';
/** An empty document on the renderer origin, for storage work before the app loads. */
export const RENDERER_BLANK_URL = `${DESKTOP_RENDERER_ORIGIN}${INTERNAL_PREFIX}blank.html`;
const BLANK_DOCUMENT =
  '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title></title>';

export const RENDERER_SCHEME: CustomScheme = {
  scheme: DESKTOP_RENDERER_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    // Chromium keeps no V8 code cache for file:// or for a custom scheme unless asked.
    codeCache: true,
  },
};

interface SchemeRegistrar {
  registerSchemesAsPrivileged: (schemes: CustomScheme[]) => void;
}

interface ProtocolHandlerRegistrar {
  handle: (scheme: string, handler: (request: Request) => Promise<Response> | Response) => void;
}

interface FileFetcher {
  fetch: (input: string) => Promise<Response>;
}

/** Must run before the app is ready, and Electron allows a single call. */
export function registerRendererScheme(protocol: SchemeRegistrar): void {
  protocol.registerSchemesAsPrivileged([RENDERER_SCHEME]);
}

function parseRendererUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== `${DESKTOP_RENDERER_SCHEME}:` || url.host !== DESKTOP_RENDERER_HOST)
      return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/** The file a renderer URL names inside `rendererRoot`, or null when it names none. */
export function resolveRendererAssetPath(
  rendererRoot: string,
  requestUrl: string,
  pathApi: typeof path = path
): string | null {
  const url = parseRendererUrl(requestUrl);
  if (!url) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.startsWith(INTERNAL_PREFIX)) return null;
  // Windows opens `x.js.`, `x.js ` and `x.js::$DATA` as `x.js`, which would dodge the name-keyed worker CSP.
  if (pathname.split(/[/\\]/).some(segment => /[. ]$|:/.test(segment))) return null;
  const root = pathApi.resolve(rendererRoot);
  const candidate = pathApi.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
  const relative = pathApi.relative(root, candidate);
  if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative)) return null;
  return candidate;
}

// Electron's fs reads inside app.asar.
async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export function createRendererProtocolHandler(args: {
  net: FileFetcher;
  rendererRoot: string;
  isFile?: (filePath: string) => Promise<boolean>;
}): (request: Request) => Promise<Response> {
  const isFile = args.isFile ?? isRegularFile;
  const root = path.resolve(args.rendererRoot);
  return async request => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }
    if (request.url === RENDERER_BLANK_URL) {
      return new Response(BLANK_DOCUMENT, { headers: { 'content-type': 'text/html' } });
    }
    const assetPath = resolveRendererAssetPath(args.rendererRoot, request.url);
    if (!assetPath) return new Response(null, { status: 404 });
    // A network error fails a missing index.html's load with ERR_FAILED, which the
    // startup dialog names; a rejected handler surfaces as ERR_UNEXPECTED instead.
    // Directories never reach the file loader, which would list them.
    if (!(await isFile(assetPath))) return Response.error();
    // Keyed on the file served, so every spelling of its URL gets the same policy.
    const csp = workerScriptCsp(path.relative(root, assetPath).split(path.sep).join('/'));
    try {
      const response = await args.net.fetch(pathToFileURL(assetPath).href);
      return csp ? withHeader(response, 'content-security-policy', csp) : response;
    } catch {
      return Response.error();
    }
  };
}

// A fetched response's headers are immutable.
function withHeader(response: Response, name: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function installRendererProtocol(args: {
  protocol: ProtocolHandlerRegistrar;
  net: FileFetcher;
  rendererRoot: string;
}): void {
  args.protocol.handle(DESKTOP_RENDERER_SCHEME, createRendererProtocolHandler(args));
}
