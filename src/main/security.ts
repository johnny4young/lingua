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

  // A packaged shell owns one document, not every file on the host. Dev
  // servers likewise serve arbitrary files: same-origin is not sufficient.
  if (
    document.protocol !== 'file:' &&
    (!isTrustedRendererUrl(document.href) || !isTrustedRendererUrl(target.href))
  ) {
    return false;
  }

  target.hash = '';
  document.hash = '';
  return target.href === document.href;
}
