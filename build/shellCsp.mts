import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';

const BOOTSTRAP = /<script id="lingua-theme-bootstrap">([\s\S]*?)<\/script>/g;
const CSP_META = /<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/g;

/** Trusted build input only; this is not a sanitizer for arbitrary user HTML. */
export function hardenShellCsp(html: string): string {
  const scripts = [...html.matchAll(BOOTSTRAP)];
  const policies = [...html.matchAll(CSP_META)];
  if (scripts.length !== 1 || policies.length !== 1) {
    throw new Error('Shell CSP requires exactly one identified bootstrap and one policy');
  }
  // HTML parsing normalizes CRLF/CR before CSP hashes are compared.
  const body = scripts[0]![1]!.replace(/\r\n?/g, '\n');
  const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
  const meta = policies[0]![0];
  const policy = meta.match(/\bcontent="([^"]*)"/)?.[1];
  if (!policy) throw new Error('Shell CSP has no policy content');
  const directives = policy.split(';');
  const scriptIndices = directives.flatMap((part, index) =>
    part.trim().startsWith('script-src ') ? [index] : []
  );
  if (
    scriptIndices.length !== 1 ||
    directives.some(part => /^\s*script-src-(elem|attr)\b/.test(part))
  ) {
    throw new Error('Shell CSP requires one script-src with no overriding script directives');
  }
  const index = scriptIndices[0]!;
  const tokens = directives[index]!.trim()
    .split(/\s+/)
    .filter(token => token !== "'unsafe-inline'");
  // Never silently hash another inline script added by a plugin or template.
  const withoutBootstrap = html.replace(BOOTSTRAP, '');
  for (const match of withoutBootstrap.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(match[1]!) && match[2]!.trim()) {
      throw new Error('Unexpected inline script in shell HTML');
    }
  }
  directives[index] = ` ${[...new Set([...tokens, hash])].join(' ')}`;
  return html.replace(meta, meta.replace(policy, directives.join(';')));
}

/** Hash after Vite's HTML transforms; HMR keeps its development-only inline preamble. */
export function shellCspPlugin(): Plugin {
  return {
    name: 'lingua-shell-csp',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: hardenShellCsp },
  };
}
