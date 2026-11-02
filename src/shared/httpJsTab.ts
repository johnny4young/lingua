/**
 * An HTTP request as a JavaScript tab that runs in the Worker. Nothing secret
 * reaches the file: every `{{key}}` becomes an entry of a `vars` object at the
 * top for the user to fill in, and a literal credential is withheld the same
 * way, since a tab is saved with the session.
 */

import { resolveWireShape } from './httpCodegen';
import { variableTokenMatcher } from './httpEnvironment';
import { isHeaderSensitive } from './httpWorkspaceHeaders';
import type { HttpRequestV1 } from './httpWorkspaceSchema';
import { keyLooksSensitive } from './redaction';

export interface HttpJsTabOptions {
  /** The user's own sensitive header names, on top of the baseline. */
  sensitiveHeaders: readonly string[];
  /** The comment above `vars`, in the user's language. */
  fillInComment: string;
}

const placeholder = (key: string) => `{{${key}}}`;
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'secret';

/** True when nothing but placeholders and an auth scheme word is written out. */
function isWithoutLiteral(value: string): boolean {
  return value.replace(variableTokenMatcher(), '').replace(/^\s*(?:bearer|basic|token)\b/i, '').trim().length === 0;
}

const withhold = (value: string, key: string) => (isWithoutLiteral(value) ? value : placeholder(key));

/** The URL with literal values of credential-looking query parameters withheld. */
function withholdUrl(url: string): string {
  // A password in the authority is a credential too.
  const withoutUser = url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#@]*@/i, (_, scheme: string) => `${scheme}${placeholder('url_credentials')}@`);
  return withoutUser.replace(/([?&])([^=&#]+)=([^&#]*)/g, (whole, lead: string, name: string, value: string) => {
    if (!keyLooksSensitive(decodeName(name))) return whole;
    return `${lead}${name}=${withhold(value, slug(name))}`;
  });
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function withholdCredentials(request: HttpRequestV1, sensitiveHeaders: readonly string[]): HttpRequestV1 {
  const auth = request.auth;
  return {
    ...request,
    url: withholdUrl(request.url),
    headers: request.headers.map((header) =>
      isHeaderSensitive(header.name, sensitiveHeaders) ? { ...header, value: withhold(header.value, slug(header.name)) } : header
    ),
    ...(auth
      ? {
          auth: {
            ...auth,
            ...(auth.token ? { token: withhold(auth.token, 'token') } : {}),
            ...(auth.password ? { password: withhold(auth.password, 'password') } : {}),
            ...(auth.apiKeyValue ? { apiKeyValue: withhold(auth.apiKeyValue, 'api_key') } : {}),
          },
        }
      : {}),
  };
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const accessor = (key: string) => (IDENTIFIER.test(key) ? `vars.${key}` : `vars[${JSON.stringify(key)}]`);

/** A string literal, or a template that reads `vars` where a `{{key}}` was. */
function literal(value: string, keys: Set<string>): string {
  let out = '';
  let from = 0;
  const piece = (text: string) => JSON.stringify(text).slice(1, -1).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  for (const match of value.matchAll(variableTokenMatcher())) {
    const key = match[1]!;
    keys.add(key);
    out += `${piece(value.slice(from, match.index))}\${${accessor(key)}}`;
    from = match.index + match[0].length;
  }
  return from === 0 ? JSON.stringify(value) : `\`${out}${piece(value.slice(from))}\``;
}

export function buildHttpJsTab(request: HttpRequestV1, options: HttpJsTabOptions): string {
  const safe = withholdCredentials(request, options.sensitiveHeaders);
  const basic = safe.auth?.kind === 'basic' && (safe.auth.username || safe.auth.password) ? safe.auth : null;
  const shape = resolveWireShape(safe);
  const keys = new Set<string>();
  const url = literal(shape.url, keys);
  // Basic's header is base64 of the placeholders, so the tab encodes it when it runs.
  const headerLines = shape.headers
    .filter((header) => !basic || header.name.toLowerCase() !== 'authorization')
    .map((header) => `    ${JSON.stringify(header.name)}: ${literal(header.value, keys)},`);
  if (basic) {
    const credentials = literal(`${basic.username ?? ''}:${basic.password ?? ''}`, keys);
    headerLines.push(`    "Authorization": "Basic " + btoa(String.fromCodePoint(...new TextEncoder().encode(${credentials}))),`);
  }
  const body = shape.body !== null ? literal(shape.body, keys) : null;
  const lines = [
    ...(keys.size > 0
      ? [
          `// ${options.fillInComment.replace(/\s+/g, ' ')}`,
          'const vars = {',
          ...[...keys].map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(placeholder(key))},`),
          '};',
          '',
        ]
      : []),
    `const response = await fetch(${url}, {`,
    `  method: ${JSON.stringify(shape.method)},`,
    ...(headerLines.length > 0 ? ['  headers: {', ...headerLines, '  },'] : []),
    ...(body !== null ? [`  body: ${body},`] : []),
    '});',
    'const data = await response.text();',
    'console.log(response.status, data);',
    '',
  ];
  return lines.join('\n');
}
