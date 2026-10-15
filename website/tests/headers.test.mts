import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const headers = await readFile(resolve(here, '../public/_headers'), 'utf8');

/** Header lines of the `_headers` rule for exactly `path`. */
function rule(path: string): string[] {
  const lines = headers.split('\n');
  const start = lines.indexOf(path);
  assert.notEqual(start, -1, `_headers has no ${path} rule`);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  ')) break;
    body.push(line.trim());
  }
  return body;
}

test('pages are served with no-transform so Cloudflare cannot inject scripts', () => {
  assert.ok(rule('/*').some(line => /^Cache-Control: .*\bno-transform\b/u.test(line)));
});

test('longer-cached paths detach the page default instead of joining it', () => {
  for (const path of ['/fonts/*', '/static/*', '/_astro/*', '/press/lingua-press-kit.zip']) {
    const body = rule(path);
    const detach = body.indexOf('! Cache-Control');
    const set = body.findIndex(line => line.startsWith('Cache-Control:'));
    assert.ok(detach !== -1 && set > detach, `${path} must detach before setting Cache-Control`);
  }
});

test('the CSP still allows the injected Pages Analytics beacon', () => {
  const csp = rule('/*').find(line => line.startsWith('Content-Security-Policy:')) ?? '';
  assert.match(csp, /script-src [^;]*https:\/\/static\.cloudflareinsights\.com/u);
  assert.match(csp, /connect-src [^;]*https:\/\/cloudflareinsights\.com/u);
});
