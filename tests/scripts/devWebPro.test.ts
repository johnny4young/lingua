import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  WEB_DEV_PRO_PORT,
  buildViteDevServerEnv,
  buildViteDevServerArgs,
  resolveVitePort,
} from '../../scripts/dev-web-pro.mjs';

/**
 * Smoke tests for `scripts/dev-web-pro.mjs`.
 *
 * The wrapper mints the keypair, prints the token, and then launches the
 * dev server. CI does not need the actual server, so tests set the internal
 * `LINGUA_DEV_SESSION_SKIP_LAUNCH=1` hook and only validate the emitted
 * token + payload shape.
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

  it('honors custom tier and issued-to values in the emitted token payload', async () => {
    const token = await runWrapperAndReadToken([
      '--tier',
      'team',
      '--days',
      '7',
      '--issued-to',
      'ci@local',
    ]);

    const [payloadPart = ''] = token.split('.');
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString();
    const payload = JSON.parse(decoded) as { tier?: string; issuedTo?: string };

    expect(payload.tier).toBe('team');
    expect(payload.issuedTo).toBe('ci@local');
  });

  it('launches vite on a strict port so the printed token cannot target a stale server', () => {
    const args = buildViteDevServerArgs(['--host', '127.0.0.1'], ['--open']);

    expect(args).toEqual([
      expect.stringContaining('vite'),
      '--config',
      'vite.web.config.mts',
      '--port',
      WEB_DEV_PRO_PORT,
      '--strictPort',
      '--host',
      '127.0.0.1',
      '--open',
    ]);
  });

  it('forces the license server off so dev tokens are local-verify-only', () => {
    const env = buildViteDevServerEnv('{"kty":"OKP"}', {
      VITE_LINGUA_LICENSE_SERVER_URL: 'https://licenses.linguacode.dev',
      OTHER_ENV: 'kept',
    });

    expect(env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK).toBe('{"kty":"OKP"}');
    expect(env.VITE_LINGUA_LICENSE_SERVER_URL).toBe('');
    expect(env.OTHER_ENV).toBe('kept');
  });

  it('reports the overridden vite port in the launch banner', () => {
    expect(resolveVitePort(['--host', '127.0.0.1'])).toBe(WEB_DEV_PRO_PORT);
    expect(resolveVitePort(['--port', '5180'])).toBe('5180');
    expect(resolveVitePort(['--port=5181'])).toBe('5181');
    expect(resolveVitePort(['--port', '5180', '--port=5182'])).toBe('5182');
  });
});

function runWrapperAndReadToken(args = ['--tier', 'pro', '--days', '1']): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['./scripts/dev-web-pro.mjs', ...args],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LINGUA_DEV_SESSION_SKIP_LAUNCH: '1',
        },
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
