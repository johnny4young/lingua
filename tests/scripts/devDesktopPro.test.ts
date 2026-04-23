import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Smoke tests for `scripts/dev-desktop-pro.mjs`.
 *
 * Like the web wrapper test, CI only validates the emitted token payload and
 * relies on the internal skip-launch hook instead of opening a real Electron
 * window.
 */
describe('scripts/dev-desktop-pro.mjs', () => {
  it('prints a signed pro-tier token before launching the desktop shell', async () => {
    const token = await runWrapperAndReadToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const [payloadPart = ''] = token.split('.');
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString();
    const payload = JSON.parse(decoded) as { tier?: string; productId?: string };

    expect(payload.tier).toBe('pro');
    expect(payload.productId).toBe('lingua');
  }, 10_000);

  it('accepts dev-license flags alongside desktop-launcher args', async () => {
    const token = await runWrapperAndReadToken([
      '--tier',
      'team',
      '--days',
      '7',
      '--issued-to',
      'desktop@local',
      '--sync-main',
      '--exit-after-ms',
      '4000',
      '--',
      '--inspect-brk',
    ]);

    const [payloadPart = ''] = token.split('.');
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(padded, 'base64').toString();
    const payload = JSON.parse(decoded) as { tier?: string; issuedTo?: string };

    expect(payload.tier).toBe('team');
    expect(payload.issuedTo).toBe('desktop@local');
  });
});

function runWrapperAndReadToken(args = ['--tier', 'pro', '--days', '1']): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['./scripts/dev-desktop-pro.mjs', ...args],
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
