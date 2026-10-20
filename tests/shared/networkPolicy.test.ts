import { describe, expect, it } from 'vitest';
import { decideNetworkHost, isNetworkPolicy, networkHostOf } from '../../src/shared/networkPolicy';
import { sanitizeFeatureFlags } from '../../src/shared/featureFlags';

describe('network policy helpers', () => {
  it('reads the host of network URLs only', () => {
    expect(networkHostOf('https://API.example:8443/x')).toBe('api.example:8443');
    expect(networkHostOf('wss://socket.example/live')).toBe('socket.example');
    expect(networkHostOf('/relative', 'https://app.example/w.js')).toBe('app.example');
    expect(networkHostOf('data:text/plain,hi')).toBeNull();
    expect(networkHostOf('blob:https://app.example/1')).toBeNull();
    expect(networkHostOf('not a url')).toBeNull();
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
