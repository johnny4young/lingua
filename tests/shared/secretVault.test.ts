import { describe, expect, it } from 'vitest';
import {
  httpEnvSecretId,
  isValidSecretId,
  isValidSecretPrefix,
} from '../../src/shared/secretVault';

describe('secret ids', () => {
  it('accepts namespaced filename-safe ids only', () => {
    expect(isValidSecretId('ai.api-key')).toBe(true);
    expect(isValidSecretId('http-env.0b6f.var_1')).toBe(true);
    for (const bad of ['ai', '../ai.key', 'ai.key/x', 'AI.key', 'ai..key', 'ai.key.', 'ai.b.c.d.e', 'con.x', 'sql-db.x', 42]) {
      expect(isValidSecretId(bad)).toBe(false);
    }
  });

  it('accepts list prefixes that end in a dot', () => {
    expect(isValidSecretPrefix('http-env.')).toBe(true);
    expect(isValidSecretPrefix('http-env.env-1.')).toBe(true);
    expect(isValidSecretPrefix('http-env')).toBe(false);
    expect(isValidSecretPrefix('')).toBe(false);
  });

  it('builds a valid id even from hand-imported variable ids', () => {
    expect(httpEnvSecretId('env-1', 'var-1')).toBe('http-env.env-1.var-1');
    const odd = httpEnvSecretId('env 1', 'var/../x');
    expect(isValidSecretId(odd)).toBe(true);
    expect(odd).toBe(httpEnvSecretId('env 1', 'var/../x'));
    expect(odd).not.toBe(httpEnvSecretId('env 2', 'var/../x'));
  });
});
