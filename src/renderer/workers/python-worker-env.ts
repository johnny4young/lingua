export type PyodideRuntimeForEnvSync = {
  runPythonAsync(code: string): Promise<unknown>;
  globals: {
    set(name: string, value: unknown): void;
    delete?(name: string): void;
  };
};

export async function syncUserEnvInPyodide(
  py: PyodideRuntimeForEnvSync,
  userEnv: Record<string, string> | undefined,
  previousKeys: readonly string[]
): Promise<string[]> {
  const nextEnv = userEnv ?? {};
  const nextKeys = Object.keys(nextEnv);

  if (nextKeys.length === 0 && previousKeys.length === 0) {
    return [];
  }

  py.globals.set('_LINGUA_USER_ENV', nextEnv);
  py.globals.set('_LINGUA_PREV_ENV_KEYS', [...previousKeys]);

  try {
    await py.runPythonAsync(`
import os
try:
    _lingua_env = _LINGUA_USER_ENV.to_py() if hasattr(_LINGUA_USER_ENV, "to_py") else dict(_LINGUA_USER_ENV)
    _lingua_prev_keys = _LINGUA_PREV_ENV_KEYS.to_py() if hasattr(_LINGUA_PREV_ENV_KEYS, "to_py") else list(_LINGUA_PREV_ENV_KEYS)
    for _k in _lingua_prev_keys:
        if isinstance(_k, str) and _k not in _lingua_env:
            os.environ.pop(_k, None)
    for _k, _v in _lingua_env.items():
        if isinstance(_k, str) and isinstance(_v, str):
            os.environ[_k] = _v
finally:
    del _LINGUA_USER_ENV
    del _LINGUA_PREV_ENV_KEYS
    `);
  } finally {
    py.globals.delete?.('_LINGUA_USER_ENV');
    py.globals.delete?.('_LINGUA_PREV_ENV_KEYS');
  }

  return nextKeys;
}
