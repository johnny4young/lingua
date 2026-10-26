import { describe, expect, it } from 'vitest';
import { editGuard, runGuard } from '../../src/shared/sqlRunGuard';

const base = { name: 'edge', readOnly: false, engine: 'd1' as const };

describe('runGuard', () => {
  it('runs only proven reads on a read-only D1 connection until the name is typed', () => {
    const readOnly = { ...base, readOnly: true };
    expect(runGuard(readOnly, 'SELECT 1', {})).toEqual({ writes: false });
    expect(runGuard(readOnly, 'PRAGMA table_list', {}).refusal).toMatch(/on D1 it runs one SELECT, WITH or VALUES statement/);
    expect(runGuard(readOnly, 'PRAGMA table_list', { readWrite: { confirmName: 'edge' } })).toEqual({ writes: true });
    expect(runGuard(readOnly, 'DELETE FROM t', { readWrite: { confirmName: 'nope' } }).refusal).toMatch(/read-only/);
  });

  it('asks for the typed name before a write on production or Confirm every write, and to lift read-only', () => {
    const neon = { ...base, engine: 'neon' as const };
    expect(runGuard({ ...neon, env: 'prod' }, 'DELETE FROM t', {}).refusal).toMatch(/production/);
    expect(runGuard({ ...neon, confirmWrites: true }, 'DELETE FROM t', {}).refusal).toMatch(/Writes on this connection/);
    expect(runGuard({ ...neon, readOnly: true }, 'DELETE FROM t', {})).toEqual({ writes: true });
    expect(runGuard(neon, 'SELECT 1', { readWrite: { confirmName: 'other' } }).refusal).toMatch(/Type the connection name/);
  });
});

describe('editGuard', () => {
  it('keeps staged edits off read-only, production, unconfirmed and non-transactional connections', () => {
    expect(editGuard({ ...base, engine: 'neon', readOnly: true }, undefined)).toEqual({ ok: false, reason: 'read-only' });
    expect(editGuard({ ...base, engine: 'libsql', env: 'prod' }, undefined)).toEqual({ ok: false, reason: 'production' });
    expect(editGuard({ ...base, engine: 'libsql', confirmWrites: true }, 'nope')).toEqual({ ok: false, reason: 'confirm-needed' });
    expect(editGuard(base, undefined)).toEqual({ ok: false, reason: 'not-editable' });
    expect(editGuard({ ...base, engine: 'libsql' }, undefined)).toBeNull();
  });
});
