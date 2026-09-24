import { useCallback, useEffect, useState } from 'react';
import { pushMissingNativeToolchainNotice } from '../runners/nativeToolchainGuidance';
import { resolveUserEnvForNativeProbe } from '../runners/env';
import { cachedNativeProbe } from '../utils/nativeProbeCache';
import {
  nativeDetectStatus,
  type NativeJsRuntimeMode,
  type NativeJsRuntimeAvailability,
} from '../utils/nativeJsRuntimeStatus';

const NATIVE_JS_MODES: readonly NativeJsRuntimeMode[] = ['node', 'deno', 'bun'];
const CHECKING: NativeJsRuntimeAvailability = {
  node: 'checking',
  deno: 'checking',
  bun: 'checking',
};

function probeRuntime(mode: NativeJsRuntimeMode, refresh = false) {
  const detect = window.lingua?.[mode]?.detect;
  if (!detect) return null;
  const env = resolveUserEnvForNativeProbe(mode, window.lingua?.platform);
  return cachedNativeProbe(mode, env, () => detect(env, true), { refresh });
}

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
    queueMicrotask(() => {
      if (!cancelled) setAvailability(CHECKING);
    });
    for (const mode of NATIVE_JS_MODES) {
      const probe = probeRuntime(mode);
      if (!probe) {
        queueMicrotask(() => {
          if (!cancelled) {
            setAvailability(current => ({ ...current, [mode]: 'check-failed' }));
          }
        });
        continue;
      }
      void probe.then(
        result => {
          if (!cancelled) {
            setAvailability(current => ({ ...current, [mode]: nativeDetectStatus(result) }));
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
      let status: ReturnType<typeof nativeDetectStatus> = 'check-failed';
      try {
        const probe = probeRuntime(mode, true);
        if (probe) status = nativeDetectStatus(await probe);
      } catch {
        // A rejected probe is a failed check, not a missing binary.
      }
      setAvailability(current => ({ ...current, [mode]: status }));
      return status === 'installed' ? true : status === 'check-failed' ? 'check-failed' : false;
    });
  }, []);

  return { availability, recoverMissing };
}
