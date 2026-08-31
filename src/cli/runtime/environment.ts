// SPDX-License-Identifier: MIT
/** Minimal, auditable environment passed to code executed by the CLI. */

const COMMON_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'TMP'] as const;

const TOOLCHAIN_KEYS = [
  'NODE_PATH',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_PREFIX',
  'PYTHON',
  'VIRTUAL_ENV',
  'PYTHONPATH',
  'PYENV_VERSION',
  'GOROOT',
  'GOPATH',
  'GOMODCACHE',
  'GOCACHE',
  'GOTMPDIR',
  'GOPROXY',
  'GOSUMDB',
  'GOFLAGS',
  'GOTOOLCHAIN',
  'CARGO_HOME',
  'RUSTUP_HOME',
  'RUSTUP_TOOLCHAIN',
  'RUSTC',
  'CARGO',
  'GEM_HOME',
  'GEM_PATH',
  'BUNDLE_GEMFILE',
  'RBENV_VERSION',
  'RBENV_ROOT',
  'ASDF_RUBY_VERSION',
] as const;

const WINDOWS_KEYS = ['SYSTEMROOT', 'USERPROFILE', 'PATHEXT', 'COMSPEC'] as const;

const BLOCKED_EXPLICIT_KEYS = new Set([
  'LD_PRELOAD',
  'LD_AUDIT',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'DYLD_FRAMEWORK_PATH',
  'NODE_OPTIONS',
]);

export class CliEnvironmentError extends Error {
  readonly reason = 'blocked-environment-variable';
  constructor(readonly key: string) {
    super(`Environment variable ${key} is blocked because it can inject code into the runtime.`);
    this.name = 'CliEnvironmentError';
  }
}

export function buildCliRuntimeEnvironment(
  explicit: ReadonlyArray<{ key: string; value: string }>
): NodeJS.ProcessEnv {
  const result: Record<string, string> = {};
  const keys = [
    ...COMMON_KEYS,
    ...TOOLCHAIN_KEYS,
    ...(process.platform === 'win32' ? WINDOWS_KEYS : []),
  ];
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }

  for (const { key, value } of explicit) {
    if (BLOCKED_EXPLICIT_KEYS.has(key.toUpperCase())) {
      throw new CliEnvironmentError(key);
    }
    result[key] = value;
  }
  return result;
}
