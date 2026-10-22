import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSqlRemoteCatalogStore } from '../../src/renderer/stores/sqlRemoteCatalogStore';
import type { SqlDbIntrospectResult } from '../../src/shared/sqlDb';

let introspect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  useSqlRemoteCatalogStore.setState({ catalogs: {} });
  introspect = vi.fn(async (): Promise<SqlDbIntrospectResult> => ({ schemas: [{ name: 'public', objects: 2 }] }));
  (window as { lingua?: unknown }).lingua = { platform: 'darwin', db: { introspect } };
});
afterEach(() => {
  delete (window as { lingua?: unknown }).lingua;
});

const store = () => useSqlRemoteCatalogStore.getState();

describe('remote catalog store', () => {
  it('reads a level once, even when asked again while it loads', async () => {
    await Promise.all([store().loadSchemas('c1'), store().loadSchemas('c1')]);
    await store().loadSchemas('c1');
    expect(introspect).toHaveBeenCalledTimes(1);
    expect(store().catalogs.c1?.schemas).toEqual({ status: 'ready', value: [{ name: 'public', objects: 2 }] });
  });

  it('keeps an error with its password hint and reads again when asked', async () => {
    introspect.mockResolvedValueOnce({ errorMessage: 'This connection needs its password.', fix: 'password-needed' });
    await store().loadSchemas('c1');
    expect(store().catalogs.c1?.schemas).toEqual({ status: 'error', message: 'This connection needs its password.', passwordNeeded: true });
    await store().loadSchemas('c1');
    expect(store().catalogs.c1?.schemas?.status).toBe('ready');
  });

  it('ignores an answer that arrives after a refresh', async () => {
    let answer: (result: SqlDbIntrospectResult) => void = () => undefined;
    introspect.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const pending = store().loadObjects('c1', 'public');
    store().refresh('c1');
    answer({ objects: [{ kind: 'table', name: 'stale' }] });
    await pending;
    expect(store().catalogs.c1?.objects.public).toBeUndefined();
  });

  it('marks a capped level as truncated', async () => {
    introspect.mockResolvedValueOnce({ objects: [{ kind: 'table', name: 'a' }], truncated: true });
    await store().loadObjects('c1', 'public');
    expect(store().catalogs.c1?.objects.public).toMatchObject({ status: 'ready', truncated: true });
  });
});
