import { DESKTOP_RENDERER_SCHEME } from '../shared/desktopRendererOrigin';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isTrustedRendererUrl(value: string): boolean {
  const parsed = parseUrl(value);
  if (!parsed) {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  if (parsed.username || parsed.password) {
    return false;
  }

  return LOOPBACK_HOSTS.has(parsed.hostname);
}

export function getTrustedRendererUrl(value?: string): string | null {
  if (!value) {
    return null;
  }

  return isTrustedRendererUrl(value) ? value : null;
}

export function isAllowedNavigationTarget(
  targetUrl: string,
  trustedRendererUrl?: string | null
): boolean {
  const target = parseUrl(targetUrl);
  const document = trustedRendererUrl ? parseUrl(trustedRendererUrl) : null;
  if (!target || !document || target.username || target.password) return false;

  // The built renderer owns one document, not every file under its origin. Dev
  // servers likewise serve arbitrary files: same-origin is not sufficient.
  if (
    document.protocol !== `${DESKTOP_RENDERER_SCHEME}:` &&
    (!isTrustedRendererUrl(document.href) || !isTrustedRendererUrl(target.href))
  ) {
    return false;
  }

  target.hash = '';
  document.hash = '';
  if (target.href === document.href) return true;
  // Reload in safe mode builds its URL exactly this way in the renderer.
  document.searchParams.set('safe-mode', '1');
  return target.href === document.href;
}
