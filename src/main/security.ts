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
  const parsedTarget = parseUrl(targetUrl);
  if (!parsedTarget) {
    return false;
  }

  if (parsedTarget.protocol === 'file:') {
    return !trustedRendererUrl;
  }

  if (!trustedRendererUrl) {
    return false;
  }

  if (!isTrustedRendererUrl(targetUrl)) {
    return false;
  }

  const parsedTrusted = parseUrl(trustedRendererUrl);
  if (!parsedTrusted) {
    return false;
  }

  return parsedTarget.origin === parsedTrusted.origin;
}
