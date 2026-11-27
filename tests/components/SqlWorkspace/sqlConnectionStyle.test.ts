import { describe, expect, it } from 'vitest';
import { answerContextLabel, connectionContextLabel } from '@/components/SqlWorkspace/sqlConnectionStyle';

describe('sql connection labels', () => {
  it('names the connection and its engine, or the local engine', () => {
    expect(connectionContextLabel({ name: 'orders-dev', engine: 'postgres' })).toBe('orders-dev · Postgres');
    expect(connectionContextLabel()).toBe('DuckDB');
  });

  it('keeps only the engine for an answer when the name is or could be the host', () => {
    expect(answerContextLabel({ name: 'orders-dev', engine: 'postgres', host: 'db.internal.example' })).toBe('orders-dev · Postgres');
    expect(answerContextLabel({ name: 'db.internal.example', engine: 'postgres', host: 'db.internal.example' })).toBe('Postgres');
    expect(answerContextLabel({ name: 'mydb', engine: 'libsql', host: 'mydb.turso.io' })).toBe('Turso');
    expect(answerContextLabel({ name: 'user@10.0.0.4', engine: 'mysql' })).toBe('MySQL');
    expect(answerContextLabel({ name: 'MyDB', engine: 'libsql', host: 'mydb.turso.io' })).toBe('Turso');
    expect(answerContextLabel({ name: 'bastion', engine: 'postgres', host: 'db', ssh: { host: 'bastion', port: 22, user: 'u', auth: 'agent', secretMode: 'none' } })).toBe('Postgres');
    expect(answerContextLabel()).toBe('DuckDB');
  });
});
