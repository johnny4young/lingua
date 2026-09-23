import type { RuntimeMode } from '../../shared/runtimeModes';

export type NativeJsRuntimeMode = 'node' | 'deno' | 'bun';
export type NativeJsRuntimeStatus = 'checking' | 'installed' | 'missing' | 'check-failed';
export type NativeJsRuntimeAvailability = Record<NativeJsRuntimeMode, NativeJsRuntimeStatus>;

const READY_HINT: Record<NativeJsRuntimeMode, string> = {
  node: 'runtimeMode.hint.node.ready',
  deno: 'runtimeMode.hint.deno.ready',
  bun: 'runtimeMode.hint.bun.ready',
};

export function isNativeJsRuntimeMode(mode: RuntimeMode): mode is NativeJsRuntimeMode {
  return mode === 'node' || mode === 'deno' || mode === 'bun';
}

export function nativeJsRuntimeHintKey(
  mode: NativeJsRuntimeMode,
  status: NativeJsRuntimeStatus
): string {
  if (status === 'missing') return `runtimeMode.hint.${mode}.missingBinary`;
  if (status === 'checking') return `runtimeMode.hint.${mode}.detecting`;
  if (status === 'check-failed') return 'runtimeMode.hint.detectFailed';
  return READY_HINT[mode];
}
