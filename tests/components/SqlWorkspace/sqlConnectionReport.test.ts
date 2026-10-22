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

  it('replaces the bastion, the jump hosts, the SSH user and the key path too', () => {
    const report = buildTestReport(
      {
        ok: false,
        totalMs: 12,
        steps: [
          { id: 'resolve', status: 'ok', ms: 1, detail: 'jump.example.net → 203.0.113.9' },
          { id: 'ssh', status: 'failed', detail: 'bastion.example.net refused the sign-in for deploy using /Users/me/.ssh/id_ed25519', fix: 'ssh-auth' },
        ],
      },
      {
        name: 'orders',
        engine: 'postgres',
        host: 'db.internal',
        readOnly: false,
        passwordMode: 'keychain',
        ssh: { host: 'bastion.example.net', port: 22, user: 'deploy', auth: 'key', keyPath: '/Users/me/.ssh/id_ed25519', secretMode: 'none', jumps: [{ host: 'jump.example.net', port: 22, user: 'hop' }] },
      },
      (id) => id,
      (status) => status
    );
    expect(report).toContain('<jump host> → <address>');
    expect(report).toContain('<ssh host> refused the sign-in for <ssh user> using <file>');
    expect(report).not.toMatch(/bastion|jump\.example|deploy|id_ed25519|203\.0/);
  });
});

