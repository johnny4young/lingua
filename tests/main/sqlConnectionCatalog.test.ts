import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createConnectionCatalog } from '../../src/main/sqlConnectionCatalog';
import type { SqlConnectionV1 } from '../../src/shared/sqlConnections';

const draft = { name: 'app.db', engine: 'sqlite' as const, path: '/data/app.db', readOnly: false, passwordMode: 'none' as const };
let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('connection catalog', () => {
  it('creates, updates and removes, and reads its own file back', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-catalog-'));
    const file = path.join(dir, 'sql-connections.json');
    const catalog = createConnectionCatalog(file, () => new Date('2026-10-21T10:00:00Z'));
    const created = (await catalog.save(draft)) as SqlConnectionV1;
    expect(created).toMatchObject({ version: 1, name: 'app.db', createdAt: '2026-10-21T10:00:00.000Z' });
    expect(created.id).toMatch(/^c_[0-9a-f]{32}$/);
    await catalog.save({ ...draft, name: 'renamed' }, created.id);
    expect(await catalog.save(draft, 'c_missing')).toBeNull();
    expect((await createConnectionCatalog(file).list()).map((entry) => entry.name)).toEqual(['renamed']);
    expect(await catalog.remove(created.id)).toBe(true);
    expect(await catalog.list()).toEqual([]);
  });

  it('refuses a new connection past the limit inside its serialized write', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-catalog-'));
    const catalog = createConnectionCatalog(path.join(dir, 'sql-connections.json'));
    // Two creates racing for the last slot: exactly one wins.
    const results = await Promise.all([catalog.save(draft, undefined, 1), catalog.save({ ...draft, name: 'b' }, undefined, 1)]);
    expect(results.filter((result) => result === 'quota')).toHaveLength(1);
    expect(await catalog.list()).toHaveLength(1);
  });

  it('drops entries it cannot parse and starts empty on a corrupt file', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-catalog-'));
    const file = path.join(dir, 'sql-connections.json');
    writeFileSync(file, JSON.stringify({ connections: [{ id: '../evil', ...draft }, { version: 1, id: 'c_ok', ...draft, createdAt: 'a', updatedAt: 'b' }] }));
    expect((await createConnectionCatalog(file).list()).map((entry) => entry.id)).toEqual(['c_ok']);
    writeFileSync(file, '{not json');
    expect(await createConnectionCatalog(file).list()).toEqual([]);
  });
});
