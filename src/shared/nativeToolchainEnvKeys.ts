/**
 * Toolchain-discovery environment keys shared by main's host allowlist and
 * renderer's passive availability probes. Keep only keys needed to locate or
 * initialize a compiler; arbitrary user env belongs to explicit Run, not a
 * menu opening that can spawn an external binary.
 */
/** PATH finds binaries, HOME anchors caches, LANG keeps UTF-8 diagnostics,
 * and TMPDIR keeps temporary files under the user's chosen root. */
export const COMMON_TOOLCHAIN_KEYS = ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const;

/** Windows shell and binary lookup need these host keys. */
export const WINDOWS_TOOLCHAIN_KEYS = [
  'SYSTEMROOT', 'USERPROFILE', 'PATHEXT', 'COMSPEC',
] as const;

/** Cache and installation locations only. GOPROXY, GOSUMDB, GOFLAGS and
 * GOTOOLCHAIN are not silently inherited by passive probes. */
export const GO_TOOLCHAIN_KEYS = [
  'GOROOT', 'GOPATH', 'GOMODCACHE', 'GOCACHE', 'GOTMPDIR',
] as const;

/** rustup/cache selection only. RUSTFLAGS, RUST_BACKTRACE and RUST_LOG belong
 * to explicit user execution rather than passive discovery. */
export const RUST_TOOLCHAIN_KEYS = [
  'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'RUSTC', 'CARGO',
] as const;

/** Node module/cache lookup only. NODE_OPTIONS and other code-loading flags
 * must not be inherited by passive binary checks. */
export const NODE_TOOLCHAIN_KEYS = [
  'NODE_PATH', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_PREFIX',
] as const;

/** Deno and Bun need only their explicit per-user installation/cache roots. */
export const DENO_TOOLCHAIN_KEYS = ['DENO_DIR'] as const;
export const BUN_TOOLCHAIN_KEYS = ['BUN_INSTALL'] as const;
