/**
 * An HTTP request as a JavaScript tab that runs in the Worker. Every `{{key}}`
 * becomes an entry of a `vars` object at the top for the user to fill in, and
 * a literal in a credential's usual place is withheld the same way, since a tab
 * is saved with the session. A secret anywhere else stays as written.
 */

import { resolveWireShape } from './httpCodegen';
import { variableTokenMatcher } from './httpEnvironment';
import { isHeaderSensitive } from './httpWorkspaceHeaders';
import type { HttpRequestV1 } from './httpWorkspaceSchema';

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

// Names that carry a credential; `author` and `keyword` do not.
const CREDENTIAL_NAME =
  /token|secret|passw(?:or)?d|pwd|api[_-]?key|auth(?!or(?!iz))|bearer|credential|signature|session|jwt|hmac|(?:^|[^a-z0-9])(?:pass|otp|key|sig|sid|code)(?:$|[^a-z0-9])/i;

/** A name that is a credential, or that cannot be read and so might be. */
function isCredentialName(raw: string): boolean {
  if (raw.search(variableTokenMatcher()) !== -1) return true;
  try {
    return CREDENTIAL_NAME.test(decodeURIComponent(raw));
  } catch {
    return true;
  }
}

/** The URL with literal values of credential-looking parameters withheld, in the query or the fragment, or nested in another value. */
function withholdParams(url: string): string {
  return url.replace(/([?&;#])([^=&;#]+)=([^&;#]*)/g, (whole, lead: string, name: string, value: string) => {
    const nested = [...value.matchAll(/(?:^|[?=/])([^=?/]+)=/g)].some((match) => isCredentialName(match[1]!));
    if (!nested && !isCredentialName(name)) return whole;
    return `${lead}${name}=${withhold(value, `param_${slug(name)}`)}`;
  });
}

// `fetch` refuses a URL with credentials, so they travel as Basic auth; the last @ ends them.
// The prefix is as loose as a browser's URL parser, which also takes `https:\\` and `https:/`.
function liftUrlCredentials(request: HttpRequestV1): HttpRequestV1 {
  const cleaned = request.url.trim().replace(/[\t\r\n]/g, '');
  const match = /^((?:[a-z][a-z0-9+.-]*|\{\{[^}]+\}\}):[/\\]*)([^/?#\\]*)@/i.exec(cleaned);
  if (!match) return request;
  const url = `${match[1]}${cleaned.slice(match[0].length)}`;
  if (request.auth && request.auth.kind !== 'none') return { ...request, url };
  const colon = match[2]!.indexOf(':');
  const [username, password] = colon === -1 ? [match[2]!, ''] : [match[2]!.slice(0, colon), match[2]!.slice(colon + 1)];
  return { ...request, url, auth: { kind: 'basic', username, password } };
}

function withholdCredentials(lifted: HttpRequestV1, sensitiveHeaders: readonly string[]): HttpRequestV1 {
  const request = liftUrlCredentials(lifted);
  const auth = request.auth;
  return {
    ...request,
    url: withholdParams(request.url),
    headers: request.headers.map((header) =>
      isHeaderSensitive(header.name, sensitiveHeaders) || isCredentialName(header.name)
        ? { ...header, value: withhold(header.value, `header_${slug(header.name)}`) }
        : header
    ),
    ...(auth
      ? {
          auth: {
            ...auth,
            ...(auth.token ? { token: withhold(auth.token, 'auth_token') } : {}),
            // Many APIs put the secret in the username, with no password.
            ...(auth.username ? { username: withhold(auth.username, 'auth_username') } : {}),
            ...(auth.password ? { password: withhold(auth.password, 'auth_password') } : {}),
            ...(auth.apiKeyValue ? { apiKeyValue: withhold(auth.apiKeyValue, 'auth_api_key') } : {}),
          },
        }
      : {}),
  };
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// Generated text a value could turn into something else: `//=>` and `// @timeout` are read as
// directives even inside a string, and bidi controls can disguise what a line says.
const asSource = (text: string) =>
  text
    .replace(/\/\/(?=\s*(?:=>|@))/g, '/\\/')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
const quoted = (text: string) => asSource(JSON.stringify(text));
const accessor = (key: string) => (IDENTIFIER.test(key) ? `vars.${key}` : `vars[${quoted(key)}]`);

/** A string literal, or a template that reads `vars` where a `{{key}}` was. */
function literal(value: string, keys: Set<string>): string {
  let out = '';
  let from = 0;
  const piece = (text: string) => quoted(text).slice(1, -1).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  for (const match of value.matchAll(variableTokenMatcher())) {
    const key = match[1]!;
    keys.add(key);
    out += `${piece(value.slice(from, match.index))}\${${accessor(key)}}`;
    from = match.index + match[0].length;
  }
  return from === 0 ? quoted(value) : `\`${out}${piece(value.slice(from))}\``;
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
    .map((header) => `    ${quoted(header.name)}: ${literal(header.value, keys)},`);
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
          ...[...keys].map((key) => `  ${quoted(key)}: ${quoted(placeholder(key))},`),
          '};',
          '',
        ]
      : []),
    `const response = await fetch(${url}, {`,
    `  method: ${quoted(shape.method)},`,
    ...(headerLines.length > 0 ? ['  headers: {', ...headerLines, '  },'] : []),
    ...(body !== null ? [`  body: ${body},`] : []),
    '});',
    'const data = await response.text();',
    'console.log(response.status, data);',
    '',
  ];
  return lines.join('\n');
}
