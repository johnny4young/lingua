import { describe, expect, it } from 'vitest';

import {
  APP_ORIGIN,
  buildRuntimeAssetUrl,
  classifyInfraProbe,
  corsHeaderAllowsAppOrigin,
  summarizeInfraReadiness,
} from '../../scripts/lib/releaseInfra.mjs';

/**
 * Locks the pure release-infra-readiness logic — the classification that turns
 * a public-URL probe into ok / warn / fail. Regression guard for the v0.7.0
 * release break (R2 403 / missing CORS surfaced only at deploy time).
 */

describe('buildRuntimeAssetUrl', () => {
  it('joins the public base + versioned web-runtime key without a double slash', () => {
    expect(buildRuntimeAssetUrl('https://d.example.com/', { lib: 'duckdb', version: '1.2.3', file: 'x.wasm' })).toBe(
      'https://d.example.com/web-runtime/duckdb/1.2.3/x.wasm'
    );
    expect(buildRuntimeAssetUrl('https://d.example.com', { lib: 'ruby', version: '9.9', file: 'r.wasm' })).toBe(
      'https://d.example.com/web-runtime/ruby/9.9/r.wasm'
    );
  });
});

describe('corsHeaderAllowsAppOrigin', () => {
  it('accepts the wildcard or the exact app origin, rejects everything else', () => {
    expect(corsHeaderAllowsAppOrigin('*')).toBe(true);
    expect(corsHeaderAllowsAppOrigin(APP_ORIGIN)).toBe(true);
    expect(corsHeaderAllowsAppOrigin(` ${APP_ORIGIN} `)).toBe(true);
    expect(corsHeaderAllowsAppOrigin('https://evil.example.com')).toBe(false);
    expect(corsHeaderAllowsAppOrigin(null)).toBe(false);
    expect(corsHeaderAllowsAppOrigin(undefined)).toBe(false);
    expect(corsHeaderAllowsAppOrigin('')).toBe(false);
  });
});

describe('classifyInfraProbe', () => {
  const url = 'https://d.example.com/web-runtime/duckdb/1/x.wasm';

  it('200 + app-origin CORS → ok', () => {
    expect(classifyInfraProbe({ url, kind: 'runtime-asset', status: 200, acao: APP_ORIGIN }).level).toBe('ok');
    expect(classifyInfraProbe({ url, kind: 'runtime-asset', status: 200, acao: '*' }).level).toBe('ok');
  });

  it('200 without CORS → fail (the browser would block it)', () => {
    const r = classifyInfraProbe({ url, kind: 'runtime-asset', status: 200, acao: null });
    expect(r.level).toBe('fail');
    expect(r.detail).toMatch(/Access-Control-Allow-Origin/u);
  });

  it('403 → fail (the v0.7.0 break: bucket public access / CORS off)', () => {
    const r = classifyInfraProbe({ url, kind: 'runtime-asset', status: 403, acao: null });
    expect(r.level).toBe('fail');
    expect(r.detail).toMatch(/403/u);
  });

  it('404 on a runtime asset → warn (version bump not yet mirrored)', () => {
    expect(classifyInfraProbe({ url, kind: 'runtime-asset', status: 404, acao: null }).level).toBe('warn');
  });

  it('404 on the sentinel → fail (mirror never initialized)', () => {
    expect(classifyInfraProbe({ url, kind: 'sentinel', status: 404, acao: null }).level).toBe('fail');
  });

  it('network error / unexpected status → fail', () => {
    expect(classifyInfraProbe({ url, kind: 'runtime-asset', status: null, acao: null }).level).toBe('fail');
    expect(classifyInfraProbe({ url, kind: 'runtime-asset', status: 500, acao: null }).level).toBe('fail');
  });
});

describe('summarizeInfraReadiness', () => {
  it('fails closed when R2_PUBLIC_BASE is not configured', () => {
    const s = summarizeInfraReadiness({ publicBaseConfigured: false, probes: [] });
    expect(s.ok).toBe(false);
    expect(s.configError).toMatch(/R2_PUBLIC_BASE/u);
  });

  it('fails when any probe failed', () => {
    const s = summarizeInfraReadiness({
      publicBaseConfigured: true,
      probes: [
        { url: 'a', level: 'ok', detail: '' },
        { url: 'b', level: 'fail', detail: '403' },
      ],
    });
    expect(s.ok).toBe(false);
    expect(s.failures).toHaveLength(1);
  });

  it('passes (ok) when only warnings are present', () => {
    const s = summarizeInfraReadiness({
      publicBaseConfigured: true,
      probes: [
        { url: 'a', level: 'ok', detail: '' },
        { url: 'b', level: 'warn', detail: 'not yet mirrored' },
      ],
    });
    expect(s.ok).toBe(true);
    expect(s.warnings).toHaveLength(1);
  });
});
