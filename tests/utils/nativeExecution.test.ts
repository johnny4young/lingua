import { afterEach, describe, expect, it } from 'vitest';
import { requiresNativeExecutionAcknowledgement } from '@/utils/nativeExecution';

const originalLingua = window.lingua;

afterEach(() => {
  window.lingua = originalLingua;
});

describe('requiresNativeExecutionAcknowledgement', () => {
  it('gates Python only when native debugging is requested', () => {
    window.lingua = { platform: 'darwin' } as unknown as LinguaAPI;

    expect(requiresNativeExecutionAcknowledgement('python')).toBe(false);
    expect(
      requiresNativeExecutionAcknowledgement('python', {
        pythonDebuggerRequested: true,
      })
    ).toBe(true);
  });

  it('never opens the native trust gate in the web build', () => {
    window.lingua = { platform: 'web' } as unknown as LinguaAPI;

    expect(
      requiresNativeExecutionAcknowledgement('python', {
        pythonDebuggerRequested: true,
      })
    ).toBe(false);
  });
});
