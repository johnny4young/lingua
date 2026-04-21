import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Smoke test for `scripts/dev-web-pro.mjs`.
 *
 * The wrapper mints the keypair, prints the token, and then execs vite via
 * `npx`. We can't actually wait for vite to bind a port in CI, so we:
 *
 *   1. Invoke the wrapper with `PATH=/nonexistent-path` so its `npx vite`
 *      call fails fast — the token is printed BEFORE the spawn, so stdout
 *      still has it.
 *   2. Read stdout until the token regex matches, then kill the child.
 *   3. Decode the token payload and assert `tier=pro` + `productId=lingua`.
 *
 * Signature correctness of the same primitive is already covered in
 * `mintDevLicense.test.ts`; this test pins the wrapper's printed payload
 * shape so a refactor can't silently stop emitting the token.
 */
describe('scripts/dev-web-pro.mjs', () => {
  it('prints a signed pro-tier token before spawning vite', async () => {
    const token = await runWrapperAndReadToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const [payloadPart = ''] = token.split('.');
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString();
    const payload = JSON.parse(decoded) as { tier?: string; productId?: string };

    expect(payload.tier).toBe('pro');
    expect(payload.productId).toBe('lingua');
  }, 10_000);
});

function runWrapperAndReadToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['./scripts/dev-web-pro.mjs', '--tier', 'pro', '--days', '1'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PATH: '/nonexistent-path' },
      }
    );

    let stdout = '';
    let resolved = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (resolved) return;
      const match = stdout.match(/^(ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/m);
      if (match) {
        resolved = true;
        // Kill the wrapper (and the vite child if it was already forked) —
        // we don't need the server to start for this test.
        child.kill('SIGTERM');
        resolve(match[1] ?? '');
      }
    });
    child.on('error', reject);
    child.on('close', () => {
      if (resolved) return;
      reject(new Error(`Wrapper did not print a token. stdout was:\n${stdout}`));
    });
  });
}
