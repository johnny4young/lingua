/**
 * Desktop path of the trial, education and recovery services: with
 * `window.lingua.license` present they go through main and never fetch.
 * The web path is covered by each service's own suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TRIAL_INPUT = { email: 'me@example.com', deviceId: 'd-1', deviceName: 'MacBook', os: 'darwin' };

const CASES = [
  {
    method: 'startTrial',
    load: async () => (await import('../../src/renderer/services/trialServer')).startTrial,
    input: TRIAL_INPUT,
  },
  {
    method: 'startEducation',
    load: async () => (await import('../../src/renderer/services/educationServer')).startEducation,
    input: TRIAL_INPUT,
  },
  {
    method: 'renewEducation',
    load: async () => (await import('../../src/renderer/services/educationServer')).renewEducation,
    input: { token: 'tok.sig', email: 'me@uni.edu' },
  },
  {
    method: 'startRecovery',
    load: async () => (await import('../../src/renderer/services/recoveryServer')).startRecovery,
    input: { email: 'me@example.com' },
  },
] as const;

type AnyService = (input: unknown) => Promise<unknown>;

const originalLingua = window.lingua;
const fetchMock = vi.fn();

function installBridge(method: string, impl: (input: unknown) => Promise<unknown>) {
  const call = vi.fn(impl);
  window.lingua = { license: { [method]: call } } as unknown as LinguaAPI;
  return call;
}

beforeEach(() => {
  vi.stubEnv('VITE_LINGUA_LICENSE_SERVER_URL', 'https://licenses.test.local');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  window.lingua = originalLingua;
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(CASES)('$method on desktop', ({ method, load, input }) => {
  it('sends the input through main and returns its result untouched', async () => {
    const answer = { ok: false, reason: 'rate-limited', retryAfter: 60 };
    const call = installBridge(method, async () => answer);
    const service = (await load()) as AnyService;

    await expect(service(input)).resolves.toBe(answer);
    expect(call).toHaveBeenCalledWith(input);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a rejected IPC call to unreachable instead of throwing', async () => {
    installBridge(method, async () => {
      throw new Error("No handler registered for 'license:x'");
    });
    const service = (await load()) as AnyService;

    await expect(service(input)).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
      message: "No handler registered for 'license:x'",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
