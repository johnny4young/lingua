/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import wranglerToml from '../wrangler.toml?raw';
import app from '../src/index';
import { createMockEnv } from './helpers';

const EXPECTED_CONFIGURED_ORIGINS = [
  'https://linguacode.dev',
  'https://app.linguacode.dev',
  'http://localhost:5174',
  'http://localhost:4173',
];

function configuredCorsOrigins(toml = wranglerToml): string[] {
  const match = toml.match(/^\s*CORS_ALLOWED_ORIGINS\s*=\s*"([^"]*)"\s*(?:#.*)?$/mu);
  if (!match?.[1]) {
    throw new Error('wrangler.toml must define CORS_ALLOWED_ORIGINS');
  }
  return match[1]
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

async function preflight(origin: string, corsAllowedOrigins: string): Promise<Response> {
  return app.request(
    'https://licenses.linguacode.dev/licenses/activate',
    {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    },
    createMockEnv({ corsAllowedOrigins })
  );
}

describe('license-server CORS', () => {
  it('keeps both production browser origins in the deployed Worker configuration', () => {
    expect([...configuredCorsOrigins()].sort()).toEqual([...EXPECTED_CONFIGURED_ORIGINS].sort());
  });

  it('accepts harmless TOML whitespace and inline comments around the configured value', () => {
    expect(
      configuredCorsOrigins(
        '  CORS_ALLOWED_ORIGINS = "https://app.linguacode.dev"  # production web app'
      )
    ).toEqual(['https://app.linguacode.dev']);
  });

  it('allows the production app origin with the license route contract', async () => {
    const origin = 'https://app.linguacode.dev';
    const response = await preflight(origin, configuredCorsOrigins().join(','));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('access-control-allow-methods')).toBe('GET,POST,OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('Content-Type,Authorization');
    expect(response.headers.get('access-control-max-age')).toBe('86400');
  });

  it('adds the app origin to non-preflight responses, including validation errors', async () => {
    const origin = 'https://app.linguacode.dev';
    const response = await app.request(
      'https://licenses.linguacode.dev/licenses/status',
      { headers: { origin } },
      createMockEnv({ corsAllowedOrigins: configuredCorsOrigins().join(',') })
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('trims configured origins before matching', async () => {
    const origin = 'https://app.linguacode.dev';
    const response = await preflight(
      origin,
      ' https://linguacode.dev, https://app.linguacode.dev '
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  });

  it('does not grant an unconfigured origin', async () => {
    const response = await preflight('https://attacker.example', configuredCorsOrigins().join(','));

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not grant requests without an Origin header', async () => {
    const response = await app.request(
      'https://licenses.linguacode.dev/licenses/activate',
      {
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
        },
      },
      createMockEnv({ corsAllowedOrigins: configuredCorsOrigins().join(',') })
    );

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
