import { useEffect, useState } from 'react';
import {
  COMMON_TOOLCHAIN_KEYS,
  GO_TOOLCHAIN_KEYS,
  RUST_TOOLCHAIN_KEYS,
  WINDOWS_TOOLCHAIN_KEYS,
} from '../../shared/nativeToolchainEnvKeys';
import { resolveUserEnvForRunner } from '../runners/env';
import type {
  NativeLanguageToolchain,
  NativeLanguageToolchainAvailability,
} from '../utils/nativeLanguageToolchainStatus';

// A passive menu/palette check must not hand project secrets or code-loading
// flags to an external go/rustc executable. Explicit Run still receives the
// full user environment by design.
const TOOLCHAIN_PROBE_KEYS = { go: GO_TOOLCHAIN_KEYS, rust: RUST_TOOLCHAIN_KEYS };

function probeEnvFor(
  language: NativeLanguageToolchain,
  userEnv: Record<string, string>,
  isWindows: boolean
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    ...COMMON_TOOLCHAIN_KEYS,
    ...(isWindows ? WINDOWS_TOOLCHAIN_KEYS : []),
    ...TOOLCHAIN_PROBE_KEYS[language],
  ]) {
    const value = userEnv[key];
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

const CHECKING: NativeLanguageToolchainAvailability = {
  go: 'checking',
  rust: 'checking',
};

/** Probe only while a desktop language surface is open, never in the web shell. */
export function useNativeLanguageToolchainAvailability(
  enabled: boolean
): NativeLanguageToolchainAvailability {
  const [availability, setAvailability] = useState<NativeLanguageToolchainAvailability>(CHECKING);
  const isWeb = typeof window === 'undefined' || window.lingua?.platform === 'web';

  useEffect(() => {
    if (!enabled || isWeb) return;
    let cancelled = false;
    // Reset on reopen before any IPC result settles, without a synchronous
    // render cascade inside the effect. StrictMode cleanup owns this task too.
    queueMicrotask(() => {
      if (!cancelled) setAvailability(CHECKING);
    });
    const userEnv = resolveUserEnvForRunner();
    for (const language of ['go', 'rust'] as const) {
      const bridge = window.lingua?.[language];
      if (!bridge?.detect) {
        queueMicrotask(() => {
          if (!cancelled) {
            setAvailability(current => ({ ...current, [language]: 'check-failed' }));
          }
        });
        continue;
      }
      void bridge.detect(probeEnvFor(language, userEnv, window.lingua?.platform === 'win32')).then(
        result => {
          if (!cancelled) {
            setAvailability(current => ({
              ...current,
              [language]: result.installed
                ? 'installed'
                : result.reason === 'missing' ? 'missing' : 'check-failed',
            }));
          }
        },
        () => {
          if (!cancelled) {
            setAvailability(current => ({ ...current, [language]: 'check-failed' }));
          }
        }
      );
    }
    return () => { cancelled = true; };
  }, [enabled, isWeb]);

  return availability;
}
