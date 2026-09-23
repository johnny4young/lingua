import { useCallback, useEffect, useState } from 'react';
import { pushMissingNativeToolchainNotice } from '../runners/nativeToolchainGuidance';
import { resolveUserEnvForRunner } from '../runners/env';
import type { NativeJsRuntimeMode, NativeJsRuntimeAvailability } from '../utils/nativeJsRuntimeStatus';

const NATIVE_JS_MODES: readonly NativeJsRuntimeMode[] = ['node', 'deno', 'bun'];
const CHECKING: NativeJsRuntimeAvailability = {
  node: 'checking',
  deno: 'checking',
  bun: 'checking',
};

/** Probe only while a native-runtime surface is open; never probe in the web shell. */
export function useNativeJsRuntimeAvailability(enabled: boolean): {
  availability: NativeJsRuntimeAvailability;
  recoverMissing: (mode: NativeJsRuntimeMode) => void;
} {
  const [availability, setAvailability] = useState<NativeJsRuntimeAvailability>(CHECKING);
  const isWeb = typeof window === 'undefined' || window.lingua?.platform === 'web';

  useEffect(() => {
    if (!enabled || isWeb) return;
    let cancelled = false;
    setAvailability(CHECKING);
    const userEnv = resolveUserEnvForRunner();
    for (const mode of NATIVE_JS_MODES) {
      const bridge = window.lingua?.[mode];
      if (!bridge?.detect) {
        setAvailability(current => ({ ...current, [mode]: 'check-failed' }));
        continue;
      }
      void bridge.detect(userEnv, true).then(
        result => {
          if (!cancelled) {
            setAvailability(current => ({
              ...current,
              [mode]: result.installed ? 'installed' : 'missing',
            }));
          }
        },
        () => {
          if (!cancelled) {
            setAvailability(current => ({ ...current, [mode]: 'check-failed' }));
          }
        }
      );
    }
    return () => { cancelled = true; };
  }, [enabled, isWeb]);

  const recoverMissing = useCallback((mode: NativeJsRuntimeMode) => {
    pushMissingNativeToolchainNotice(mode, async () => {
      const bridge = window.lingua?.[mode];
      if (!bridge?.detect) {
        setAvailability(current => ({ ...current, [mode]: 'check-failed' }));
        return false;
      }
      const result = await bridge.detect(resolveUserEnvForRunner(), true);
      setAvailability(current => ({
        ...current,
        [mode]: result.installed ? 'installed' : 'missing',
      }));
      return result.installed;
    });
  }, []);

  return { availability, recoverMissing };
}
