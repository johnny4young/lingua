import { describe, expect, it } from 'vitest';
import { decideNetworkHost, isNetworkHost, isNetworkPolicy } from '../../src/shared/networkPolicy';
import { sanitizeFeatureFlags } from '../../src/shared/featureFlags';

describe('network policy helpers', () => {
  it('accepts host[:port] shapes only', () => {
    expect(
      ['api.example:8443', 'socket.example', '[::1]:8080', 'xn--bcher-kva.example'].every(
        isNetworkHost
      )
    ).toBe(true);
    expect(isNetworkHost({})).toBe(false);
    expect(isNetworkHost('a.example/<img>')).toBe(false);
    expect(isNetworkHost('x'.repeat(300))).toBe(false);
  });

  it('lets an earlier answer win over the policy', () => {
    const run = {
      policy: 'ask' as const,
      allowedHosts: ['a.example'],
      blockedHosts: ['b.example'],
    };
    expect(decideNetworkHost(run, 'a.example')).toBe('allow');
    expect(decideNetworkHost(run, 'b.example')).toBe('block');
    expect(decideNetworkHost(run, 'c.example')).toBe('ask');
    expect(decideNetworkHost({ ...run, policy: 'allow' }, 'b.example')).toBe('allow');
    expect(decideNetworkHost({ ...run, policy: 'block' }, 'a.example')).toBe('block');
  });

  it('accepts only the three policies', () => {
    expect(['allow', 'ask', 'block'].every(isNetworkPolicy)).toBe(true);
    expect(isNetworkPolicy('deny')).toBe(false);
    expect(isNetworkPolicy(undefined)).toBe(false);
  });
});

describe('feature flags', () => {
  it('keeps only known flags that are explicitly on', () => {
    expect(sanitizeFeatureFlags({ networkPolicy: true, unknown: true })).toEqual({
      networkPolicy: true,
    });
    expect(sanitizeFeatureFlags({ networkPolicy: 'yes' })).toEqual({});
    expect(sanitizeFeatureFlags(null)).toEqual({});
  });
});
