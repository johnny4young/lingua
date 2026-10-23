import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlConnectionDraft } from '../../../src/shared/sqlConnections';
import type { HttpSqlRequest } from '../../../src/shared/sqlHttp/transport';
import { createWebSqlDb, fetchTransport } from '../../../src/renderer/runtime/sqlWebDb';

const turso: SqlConnectionDraft = { name: 'notes', engine: 'libsql', host: 'notes-acme.turso.io', port: 443, ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'keychain' };

const pipeline = (result: unknown) => ({
  status: 200,
  body: JSON.stringify({ baton: null, base_url: null, results: [{ type: 'ok', response: { type: 'execute', result } }, { type: 'ok', response: { type: 'close' } }] }),
});
const versionRows = { cols: [{ name: 'v' }], rows: [[{ type: 'text', value: '3.45.1' }]], affected_row_count: 0 };

function bridge(reply: (request: HttpSqlRequest) => { status: number; body: string } = () => pipeline(versionRows)) {
  const sent: HttpSqlRequest[] = [];
  const db = createWebSqlDb(async (request) => {
    sent.push(request);
    return reply(request);
  });
  return { db, sent };
}

afterEach(() => vi.unstubAllGlobals());

describe('web database bridge', () => {
  it('opens only HTTPS Turso and Neon connections, for this tab, at no quota', async () => {
    const { db } = bridge();
    expect(await db.openAdhoc({ ...turso, engine: 'postgres', host: 'db.internal', port: 5432 })).toEqual({ ok: false, reason: 'invalid' });
    expect(await db.openAdhoc({ name: 'edge', engine: 'd1', d1: { accountId: 'a'.repeat(32), databaseId: '0f0e0d0c-1111-2222-3333-444455556666' }, readOnly: false, passwordMode: 'keychain' }, 'cf')).toEqual({ ok: false, reason: 'invalid' });
    expect(await db.openAdhoc({ ...turso, ssl: { mode: 'disable' } })).toEqual({ ok: false, reason: 'invalid' });
    const opened = await db.openAdhoc(turso, 'token');
    expect(opened).toMatchObject({ ok: true, connection: { engine: 'libsql', passwordMode: 'session', hasPassword: true } });
    expect(await db.save(turso)).toEqual({ ok: false, reason: 'invalid' });
    const view = await db.catalog();
    expect(view).toMatchObject({ connections: [], used: 0, limit: null, sessionOnly: true });
    expect(JSON.stringify(view)).not.toContain('token');
  });

  it('runs on the tab connection, and asks again for a token the server refused', async () => {
    let refuse = false;
    const { db, sent } = bridge(() => (refuse ? { status: 401, body: 'nope' } : pipeline(versionRows)));
    const opened = await db.openAdhoc(turso, 'token');
    const id = (opened as { connection: { id: string } }).connection.id;
    expect(await db.execute('r1', id, 'SELECT sqlite_version() AS v', { timeoutMs: 1_000 })).toMatchObject({ status: 'success', engine: 'libsql', rows: [{ v: '3.45.1' }] });
    expect(sent[0]!.headers.authorization).toBe('Bearer token');
    refuse = true;
    await db.sessionPassword(id, 'stale');
    expect(await db.execute('r2', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'connection-failed', fix: 'password-needed' });
    expect((await db.catalog()).adhoc[0]).toMatchObject({ hasPassword: false });
    expect(await db.execute('r3', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'connection-failed', fix: 'password-needed' });
  });

  it('keeps the write guards: production asks for the typed name and staged edits stay off read-only', async () => {
    const { db, sent } = bridge();
    const opened = await db.openAdhoc({ ...turso, env: 'prod', readOnly: true }, 'token');
    const id = (opened as { connection: { id: string } }).connection.id;
    expect(await db.execute('r1', id, 'DELETE FROM notes', { timeoutMs: 1_000 })).toMatchObject({ status: 'sql-error', fix: 'confirm-needed' });
    expect(await db.applyEdits(id, { schema: 'main', name: 'notes' }, { updates: [], deletes: [], inserts: [] })).toEqual({ ok: false, reason: 'read-only' });
    expect(sent).toHaveLength(0);
  });

  it('stops only the run it was asked to cancel while both wait for their answer', async () => {
    let slow = false;
    const db = createWebSqlDb(
      (request) =>
        new Promise((resolve, reject) => {
          if (!slow) return resolve(pipeline(versionRows));
          const timer = setTimeout(() => resolve(pipeline(versionRows)), 50);
          request.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        })
    );
    const a = ((await db.openAdhoc(turso, 'token')) as { connection: { id: string } }).connection.id;
    const b = ((await db.openAdhoc({ ...turso, host: 'other-acme.turso.io' }, 'token')) as { connection: { id: string } }).connection.id;
    await db.execute('warm-a', a, 'SELECT 1', { timeoutMs: 1_000 });
    await db.execute('warm-b', b, 'SELECT 1', { timeoutMs: 1_000 });
    slow = true;
    const first = db.execute('ra', a, 'SELECT 1', { timeoutMs: 5_000 });
    const second = db.execute('rb', b, 'SELECT 1', { timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await db.cancel('ra')).toEqual({ cancelled: true });
    expect(await first).toMatchObject({ status: 'cancelled' });
    expect(await second).toMatchObject({ status: 'success' });
  });

  it('tests a draft with the steps a browser can see', async () => {
    const { db } = bridge();
    const result = await db.test({ draft: turso, password: 'token' });
    expect(result).toMatchObject({ ok: true, serverVersion: 'libSQL (SQLite 3.45.1)' });
    expect(result.steps.map((step) => `${step.id}:${step.status}`)).toEqual(['tls:ok', 'auth:ok', 'server:ok']);
    expect((await db.test({ draft: turso })).steps[0]).toMatchObject({ id: 'auth', status: 'failed', fix: 'password-needed' });
  });
});

describe('fetchTransport', () => {
  it('sends no cookies or referrer and refuses redirects', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchTransport({ url: 'https://db.turso.io/v2/pipeline', headers: {}, body: '{}' })).toEqual({ status: 200, body: '{}' });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' });
  });

  it('reads a refused cross-origin request as an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchTransport({ url: 'https://db.example.com/sql', headers: {}, body: '{}' })).rejects.toMatchObject({ detail: { step: 'tcp', fix: 'unreachable' } });
  });
});
