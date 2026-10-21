import { describe, expect, it } from 'vitest';
import { buildTestReport } from '../../../src/renderer/components/SqlWorkspace/sqlConnectionReport';

describe('buildTestReport', () => {
  it('replaces the target, the user and any address or certificate name a server mentions', () => {
    const report = buildTestReport(
      {
        ok: false,
        totalMs: 40,
        steps: [
          { id: 'resolve', status: 'ok', ms: 1, detail: 'db.internal → 10.0.4.12' },
          { id: 'tls', status: 'ok', detail: 'verify-full · CN other.example.com' },
          { id: 'auth', status: 'failed', detail: "Access denied for user 'app'@'192.168.65.1' via fe80::1:2:3", fix: 'auth' },
        ],
      },
      { name: 'orders', engine: 'mysql', host: 'db.internal', user: 'app', database: 'orders', readOnly: false, passwordMode: 'keychain' },
      (id) => id,
      (status) => status
    );
    expect(report).toContain('<host> → <address>');
    expect(report).toContain('CN <name>');
    expect(report).toContain("'<user>'@'<address>' via <address>");
    expect(report).not.toMatch(/10\.0\.4\.12|192\.168|fe80|other\.example|db\.internal/);
  });
});
