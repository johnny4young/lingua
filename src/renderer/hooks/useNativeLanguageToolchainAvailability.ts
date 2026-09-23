import { useEffect, useState } from 'react';
import { resolveUserEnvForNativeProbe } from '../runners/env';
import type {
  NativeLanguageToolchainAvailability,
} from '../utils/nativeLanguageToolchainStatus';

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
      void bridge.detect(resolveUserEnvForNativeProbe(language, window.lingua?.platform)).then(
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
