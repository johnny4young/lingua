import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from 'vite';
import {
  WEB_DEV_PRO_PORT,
  buildViteDevServerEnv,
  buildViteDevServerArgs,
  resolveVitePort,
} from '../../scripts/dev-web-pro.mjs';
// @ts-expect-error — JS helper without bundled types; only used in tests.
import { mintDevLicense } from '../../scripts/dev-license-shared.mjs';
import { verifyLicenseToken } from '../../src/shared/license';

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

  /**
   * The end-to-end guard for the documented `dev:web:pro` flow: a token
   * minted by the throwaway dev keypair MUST verify against the public key
   * that Vite actually resolves into the bundle. The repo-root `.env`
   * independently defines `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` as a
   * dotenv-expand alias of the PRODUCTION key, so the only thing keeping
   * the flow working is that the dev key injected via `process.env`
   * (through `buildViteDevServerEnv`) wins inside Vite's `loadEnv`. If a
   * Vite upgrade ever flipped that precedence, every pasted dev token
   * would fail `invalid-signature` — this test fails first. Reproduced
   * hermetically (the real `.env` is gitignored, absent in CI).
   */
  it('mint -> inject public key -> verify: the injected dev key wins over a .env production-key alias and the token verifies', async () => {
    const minted = (await mintDevLicense({ tier: 'pro', days: 7, issuedTo: 'roundtrip@local' })) as {
      publicKeyJwk: string;
      token: string;
    };

    const envDir = mkdtempSync(path.join(os.tmpdir(), 'lingua-devwebpro-env-'));
    writeFileSync(
      path.join(envDir, '.env'),
      [
        // Mirror the repo-root .env: a production public key plus a
        // VITE_* alias resolved by dotenv-expand.
        `LINGUA_LICENSE_PUBLIC_KEY_JWK='{"kty":"OKP","crv":"Ed25519","x":"PRODUCTIONkeyPRODUCTIONkeyPRODUCTIONkeyXYZ"}'`,
        `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK='$LINGUA_LICENSE_PUBLIC_KEY_JWK'`,
        `VITE_LINGUA_LICENSE_SERVER_URL=''`,
        '',
      ].join('\n')
    );

    // Replicate exactly what dev-web-pro.mjs hands the spawned Vite child.
    const childEnv = buildViteDevServerEnv(minted.publicKeyJwk, { ...process.env });
    const savedEnv = { ...process.env };
    try {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, childEnv);

      const env = loadEnv('development', envDir, 'VITE_');

      // The injected dev key — not the .env production alias — must reach
      // the bundle, and the server URL must be forced empty (local-verify).
      expect(env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK).toBe(minted.publicKeyJwk);
      expect(env.VITE_LINGUA_LICENSE_SERVER_URL).toBe('');

      const publicKey = JSON.parse(env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK) as JsonWebKey;
      const result = await verifyLicenseToken(minted.token, publicKey);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload.tier).toBe('pro');
        expect(result.state).toBe('active');
      }
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, savedEnv);
      rmSync(envDir, { recursive: true, force: true });
    }
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
