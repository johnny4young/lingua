import {
  BUN_TOOLCHAIN_KEYS,
  COMMON_TOOLCHAIN_KEYS,
  DENO_TOOLCHAIN_KEYS,
  GO_TOOLCHAIN_KEYS,
  NODE_TOOLCHAIN_KEYS,
  RUST_TOOLCHAIN_KEYS,
  WINDOWS_TOOLCHAIN_KEYS,
} from '../../shared/nativeToolchainEnvKeys';

export type NativeProbeRuntime = 'go' | 'rust' | 'node' | 'deno' | 'bun';

const RUNTIME_KEYS: Record<NativeProbeRuntime, readonly string[]> = {
  go: GO_TOOLCHAIN_KEYS,
  rust: RUST_TOOLCHAIN_KEYS,
  node: NODE_TOOLCHAIN_KEYS,
  deno: DENO_TOOLCHAIN_KEYS,
  bun: BUN_TOOLCHAIN_KEYS,
};

/** Keep explicit Run's full user env separate from passive binary probes. */
export function filterNativeProbeEnv(
  runtime: NativeProbeRuntime,
  userEnv: Record<string, string>,
  platform: string | undefined
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    ...COMMON_TOOLCHAIN_KEYS,
    ...(platform === 'win32' ? WINDOWS_TOOLCHAIN_KEYS : []),
    ...RUNTIME_KEYS[runtime],
  ]) {
    const value = userEnv[key];
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}
