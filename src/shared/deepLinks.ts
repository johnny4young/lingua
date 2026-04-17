export const LINGUA_DEEP_LINK_SCHEME = 'lingua';

export type DeepLinkTarget =
  | { kind: 'open-file'; filePath: string; rawUrl: string }
  | { kind: 'open-snippet'; snippetId: string; rawUrl: string }
  | { kind: 'new-file'; language: string; rawUrl: string };

const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  go: 'go',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  env: 'dotenv',
  dotenv: 'dotenv',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  csv: 'csv',
};

function normalizeDeepLinkAction(url: URL): string {
  if (url.hostname.trim().length > 0) {
    return url.hostname.trim().toLowerCase();
  }

  return url.pathname.replace(/^\/+/u, '').split('/')[0]?.trim().toLowerCase() ?? '';
}

function normalizeDeepLinkLanguage(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function isLinguaDeepLink(value: string): boolean {
  return value.startsWith(`${LINGUA_DEEP_LINK_SCHEME}://`) || value.startsWith(`${LINGUA_DEEP_LINK_SCHEME}:`);
}

export function extractLinguaDeepLinkUrl(argv: readonly string[]): string | null {
  return argv.find((arg) => isLinguaDeepLink(arg)) ?? null;
}

export function parseLinguaDeepLink(rawUrl: string): DeepLinkTarget | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== `${LINGUA_DEEP_LINK_SCHEME}:`) {
      return null;
    }

    const action = normalizeDeepLinkAction(url);
    if (action === 'open') {
      const filePath = url.searchParams.get('file')?.trim();
      if (!filePath) {
        return null;
      }

      return {
        kind: 'open-file',
        filePath,
        rawUrl,
      };
    }

    if (action === 'snippet') {
      const snippetId = url.searchParams.get('id')?.trim();
      if (!snippetId) {
        return null;
      }

      return {
        kind: 'open-snippet',
        snippetId,
        rawUrl,
      };
    }

    if (action === 'new') {
      const language = normalizeDeepLinkLanguage(url.searchParams.get('lang'));
      if (!language) {
        return null;
      }

      return {
        kind: 'new-file',
        language,
        rawUrl,
      };
    }

    return null;
  } catch {
    return null;
  }
}
