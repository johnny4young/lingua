import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SqlConnectionSheet, type SqlConnectionSheetMode } from '../../../src/renderer/components/SqlWorkspace/SqlConnectionSheet';
import { useSqlConnectionsStore } from '../../../src/renderer/stores/sqlConnectionsStore';
import type { SqlDbCatalogView, SqlDbConnectionView, SqlDbTestResult } from '../../../src/shared/sqlDb';

const saved = (overrides: Partial<SqlDbConnectionView> = {}): SqlDbConnectionView => ({
  version: 1,
  id: 'c_1',
  name: 'orders-dev',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'orders',
  user: 'app',
  ssl: { mode: 'verify-full' },
  env: 'dev',
  readOnly: false,
  passwordMode: 'keychain',
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
  hasPassword: true,
  ...overrides,
});

const passed: SqlDbTestResult = {
  ok: true,
  totalMs: 21,
  serverVersion: 'PostgreSQL 16.4',
  steps: [
    { id: 'resolve', status: 'ok', ms: 1, detail: 'db.internal → 10.0.4.12' },
    { id: 'tcp', status: 'ok', ms: 2, detail: '10.0.4.12:5432' },
    { id: 'auth', status: 'ok', ms: 8, detail: 'app' },
    { id: 'server', status: 'ok', ms: 1, detail: 'PostgreSQL 16.4' },
  ],
};

let db: Record<string, ReturnType<typeof vi.fn>>;

function setCatalog(overrides: Partial<SqlDbCatalogView> = {}) {
  const catalog: SqlDbCatalogView = { connections: [], adhoc: [], used: 0, limit: 3, vault: 'encrypted', ...overrides };
  db.catalog!.mockResolvedValue(catalog);
  useSqlConnectionsStore.setState({ catalog });
}

function renderSheet(mode: SqlConnectionSheetMode = { kind: 'new' }) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(<SqlConnectionSheet mode={mode} onDone={onDone} onClose={onClose} />);
  return { onDone, onClose };
}

beforeEach(() => {
  db = {
    catalog: vi.fn(),
    save: vi.fn(async () => ({ ok: true, connection: saved() })),
    openAdhoc: vi.fn(async () => ({ ok: true, connection: saved({ id: 'adhoc_1', passwordMode: 'session' }) })),
    delete: vi.fn(async () => ({ ok: true })),
    test: vi.fn(async () => passed),
    pickFile: vi.fn(),
    sshInfo: vi.fn(async () => ({ config: null, agent: { available: false } })),
    trustHostKey: vi.fn(async () => ({ ok: true })),
  };
  (window as { lingua?: unknown }).lingua = { platform: 'darwin', db };
  setCatalog();
});

afterEach(() => {
  delete (window as { lingua?: unknown }).lingua;
  useSqlConnectionsStore.setState({ catalog: null });
});

describe('SqlConnectionSheet', () => {
  it('fills the form from a pasted URL and keeps its password out of the URL field', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('sql-connection-url'));
    await user.paste('postgres://app:s3cret@db.internal:5433/orders?sslmode=require');
    expect((screen.getByTestId('sql-connection-url') as HTMLInputElement).value).toBe('postgres://app@db.internal:5433/orders?sslmode=require');
    expect((screen.getByTestId('sql-connection-host') as HTMLInputElement).value).toBe('db.internal');
    expect((screen.getByTestId('sql-connection-port') as HTMLInputElement).value).toBe('5433');
    expect((screen.getByTestId('sql-connection-password') as HTMLInputElement).value).toBe('s3cret');
    expect(screen.getByTestId('sql-connection-ssl-require').getAttribute('aria-checked')).toBe('true');
  });

  it('says why a URL cannot be read', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('sql-connection-url'));
    await user.paste('mongodb://db/orders');
    expect(screen.getByText(/postgres:\/\/, mysql:\/\/ or sqlite:/)).toBeTruthy();
  });

  it('opens production read-only unless the switch was changed by hand', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('sql-connection-env-prod'));
    expect(screen.getByTestId('sql-connection-safety-readOnly').getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByTestId('sql-connection-safety-readOnly'));
    await user.click(screen.getByTestId('sql-connection-env-dev'));
    await user.click(screen.getByTestId('sql-connection-env-prod'));
    expect(screen.getByTestId('sql-connection-safety-readOnly').getAttribute('aria-checked')).toBe('false');
  });

  it('turns read-only on when a saved connection moves to production', async () => {
    const user = userEvent.setup();
    renderSheet({ kind: 'edit', connection: saved() });
    expect(screen.getByTestId('sql-connection-safety-readOnly').getAttribute('aria-checked')).toBe('false');
    await user.click(screen.getByTestId('sql-connection-env-prod'));
    expect(screen.getByTestId('sql-connection-safety-readOnly').getAttribute('aria-checked')).toBe('true');
  });

  it('tests the connection step by step and copies a report without host, address or user', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderSheet({ kind: 'edit', connection: saved() });
    await user.click(screen.getByTestId('sql-connection-test'));
    // An edit with an empty password field tests with the stored one.
    expect(db.test).toHaveBeenCalledWith({ connectionId: 'c_1' });
    expect(screen.getAllByTestId('sql-connection-step').map((step) => `${step.dataset.step}:${step.dataset.status}`)).toEqual([
      'resolve:ok',
      'tcp:ok',
      'auth:ok',
      'server:ok',
    ]);
    await user.click(screen.getByTestId('sql-connection-copy-report'));
    const report = writeText.mock.calls[0]?.[0] as string;
    expect(report).toContain('<host> → <address>');
    expect(report).toContain('<user>');
    expect(report).not.toMatch(/db\.internal|10\.0\.4\.12|\bapp\b/);
  });

  it('saves the draft with the typed password and hands the connection back', async () => {
    const user = userEvent.setup();
    const { onDone } = renderSheet();
    await user.type(screen.getByTestId('sql-connection-name'), 'orders-dev');
    await user.type(screen.getByTestId('sql-connection-host'), 'db.internal');
    await user.type(screen.getByTestId('sql-connection-password'), 'pw');
    await user.click(screen.getByTestId('sql-connection-save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(db.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'orders-dev', host: 'db.internal', passwordMode: 'keychain' }), undefined, 'pw', undefined);
  });

  it('offers only Ask each session when the system has no keyring', () => {
    setCatalog({ vault: 'session' });
    renderSheet();
    expect(screen.getByTestId('sql-connection-no-keyring')).toBeTruthy();
    expect(screen.queryByTestId('sql-connection-password-mode-keychain')).toBeNull();
    expect(screen.getByTestId('sql-connection-password-mode-session').getAttribute('aria-checked')).toBe('true');
  });

  it('at the Free limit opens the connection for the session instead of saving it', async () => {
    const user = userEvent.setup();
    setCatalog({ connections: [saved(), saved({ id: 'c_2' }), saved({ id: 'c_3' })], used: 3 });
    const { onDone } = renderSheet();
    expect(screen.getByTestId('sql-connection-limit')).toBeTruthy();
    expect(screen.getByTestId('sql-connection-save').textContent).toBe('Open without saving');
    await user.click(screen.getByTestId('sql-connection-url'));
    await user.paste('postgres://app@db.internal/orders');
    await user.click(screen.getByTestId('sql-connection-save'));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(db.openAdhoc).toHaveBeenCalledTimes(1);
    expect(db.save).not.toHaveBeenCalled();
  });

  it('asks for a second click before a saved connection is deleted', async () => {
    const user = userEvent.setup();
    setCatalog({ connections: [saved(), saved({ id: 'c_2' }), saved({ id: 'c_3' })], used: 3 });
    renderSheet();
    await user.click(screen.getByTestId('sql-connection-replace'));
    const [first] = screen.getAllByTestId('sql-connection-replace-delete');
    await user.click(first!);
    expect(db.delete).not.toHaveBeenCalled();
    expect(first!.textContent).toBe('Delete for good');
    await user.click(first!);
    await waitFor(() => expect(db.delete).toHaveBeenCalledWith('c_1'));
  });

  it('deletes the connection being edited only after the confirm click', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet({ kind: 'edit', connection: saved() });
    await user.click(screen.getByTestId('sql-connection-delete'));
    expect(db.delete).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('sql-connection-delete'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(db.delete).toHaveBeenCalledWith('c_1');
  });

  describe('SSH tunnel and safety', () => {
    it('detects the bastion in ~/.ssh/config, uses its settings and tests through the agent', async () => {
      db.sshInfo!.mockResolvedValue({
        config: { alias: 'bastion', hostName: 'bastion.example.net', user: 'deploy', port: 2222, proxyJump: [{ host: 'jump.example.net' }] },
        agent: { available: true, keys: 2 },
      });
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByTestId('sql-connection-host'), 'db.internal');
      await user.click(screen.getByTestId('sql-connection-ssh-toggle'));
      await user.type(screen.getByTestId('sql-connection-ssh-host'), 'bastion');
      await waitFor(() => expect(screen.getByTestId('sql-connection-ssh-info').textContent).toContain('agent: 2 keys loaded · ~/.ssh/config host “bastion” detected'));
      await user.click(screen.getByTestId('sql-connection-ssh-use-config'));
      expect((screen.getByTestId('sql-connection-ssh-host') as HTMLInputElement).value).toBe('bastion.example.net');
      expect(screen.getAllByTestId('sql-connection-ssh-jump')).toHaveLength(1);
      expect(screen.getByTestId('sql-connection-ssh-chain').textContent).toBe('you→jump.example.net→bastion.example.net→db.internal:5432');
      await user.click(screen.getByTestId('sql-connection-test'));
      await waitFor(() => expect(db.test).toHaveBeenCalledTimes(1));
      expect(db.test).toHaveBeenCalledWith({
        draft: expect.objectContaining({
          ssh: { host: 'bastion.example.net', port: 2222, user: 'deploy', auth: 'agent', secretMode: 'none', jumps: [{ host: 'jump.example.net', port: 22, user: 'deploy' }] },
        }),
      });
    });

    it('keeps the SSH password apart from the database password and signs jumps in only with a key or the agent', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByTestId('sql-connection-host'), 'db.internal');
      await user.type(screen.getByTestId('sql-connection-password'), 'db-pw');
      await user.click(screen.getByTestId('sql-connection-ssh-toggle'));
      await user.type(screen.getByTestId('sql-connection-ssh-host'), 'bastion');
      await user.type(screen.getByTestId('sql-connection-ssh-user'), 'deploy');
      await user.click(screen.getByTestId('sql-connection-ssh-auth-password'));
      expect(screen.getByTestId('sql-connection-ssh-add-jump')).toHaveProperty('disabled', true);
      await user.type(screen.getByTestId('sql-connection-ssh-secret'), 'ssh-pw');
      await user.click(screen.getByTestId('sql-connection-save'));
      await waitFor(() => expect(db.save).toHaveBeenCalledTimes(1));
      expect(db.save).toHaveBeenCalledWith(
        expect.objectContaining({ ssh: { host: 'bastion', port: 22, user: 'deploy', auth: 'password', secretMode: 'keychain' } }),
        undefined,
        'db-pw',
        'ssh-pw'
      );
    });

    it('picks a key and offers to trust an unknown host key, then tests again', async () => {
      const fingerprint = `SHA256:${'Q'.repeat(43)}`;
      db.pickFile!.mockResolvedValue({ canceled: false, path: '/Users/me/.ssh/id_ed25519' });
      db.test!.mockResolvedValueOnce({
        ok: false,
        totalMs: 9,
        steps: [{ id: 'ssh', status: 'failed', detail: 'unknown key', fix: 'ssh-host-unknown', hostKey: { host: 'bastion', port: 22, fingerprint } }],
      });
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByTestId('sql-connection-host'), 'db.internal');
      await user.click(screen.getByTestId('sql-connection-ssh-toggle'));
      await user.type(screen.getByTestId('sql-connection-ssh-host'), 'bastion');
      await user.type(screen.getByTestId('sql-connection-ssh-user'), 'deploy');
      await user.click(screen.getByTestId('sql-connection-ssh-auth-key'));
      await user.click(screen.getByTestId('sql-connection-ssh-key'));
      expect(db.pickFile).toHaveBeenCalledWith('ssh-key');
      expect(screen.getByTestId('sql-connection-ssh-key').textContent).toBe('id_ed25519');
      await user.click(screen.getByTestId('sql-connection-test'));
      expect((await screen.findByTestId('sql-connection-host-key-fingerprint')).textContent).toBe(fingerprint);
      await user.click(screen.getByTestId('sql-connection-trust-key'));
      expect(db.trustHostKey).toHaveBeenCalledWith('bastion', 22, fingerprint);
      await waitFor(() => expect(db.test).toHaveBeenCalledTimes(2));
      expect(await screen.findByTestId('sql-connection-test-badge')).toBeTruthy();
    });

    it('says a tunnel secret is kept only while the tunnel signs in the same way', async () => {
      const user = userEvent.setup();
      renderSheet({ kind: 'edit', connection: saved({ hasSshSecret: true, ssh: { host: 'bastion', port: 22, user: 'deploy', auth: 'password', secretMode: 'keychain' } }) });
      expect(screen.getByTestId('sql-connection-ssh-secret').getAttribute('placeholder')).toBe('kept · type to replace');
      await user.click(screen.getByTestId('sql-connection-ssh-auth-key'));
      await user.click(screen.getByTestId('sql-connection-ssh-passphrase-mode-keychain'));
      expect(screen.getByTestId('sql-connection-ssh-secret').getAttribute('placeholder')).toBe('');
    });

    it('saves Confirm every write and Allow private host off', async () => {
      const user = userEvent.setup();
      renderSheet();
      await user.type(screen.getByTestId('sql-connection-host'), 'db.internal');
      await user.click(screen.getByTestId('sql-connection-safety-confirmWrites'));
      await user.click(screen.getByTestId('sql-connection-safety-allowPrivateHost'));
      await user.click(screen.getByTestId('sql-connection-save'));
      await waitFor(() => expect(db.save).toHaveBeenCalledTimes(1));
      expect(db.save).toHaveBeenCalledWith(expect.objectContaining({ confirmWrites: true, allowPrivateHost: false }), undefined, undefined, undefined);
    });
  });
});

