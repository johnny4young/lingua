/**
 * RL-079 — Minimal env builder for native runner subprocesses.
 *
 * Before this lived, the Go and Rust runners spread `process.env`
 * directly into `execFile`/`spawn`, which leaked every secret the
 * Electron main process happens to inherit (CI tokens, OPENAI_API_KEY,
 * etc.) into the spawned toolchain. The builder picks ONLY the keys
 * a toolchain actually needs from the host env, then layers the
 * user-tier env from RL-011 on top, then applies runner-owned
 * overrides (e.g. `GOOS=js` / `GOARCH=wasm` for Go) last so user env
 * cannot shadow them.
 *
 * The toolchain-key allowlists are intentionally tight in v1 — if a
 * smoke run on a real host fails because we omitted a key the
 * toolchain needs, add it here explicitly with a comment naming the
 * smoke. Widening on guesswork defeats the leakage defense.
 */

/**
 * Common host-env keys both toolchains need. Lean on purpose:
 *  - PATH lets the toolchain find its own binaries (linker, etc.).
 *  - HOME anchors the per-user toolchain caches (.cargo, .cache/go-build).
 *  - LANG ensures rustc emits UTF-8 diagnostics on locales like POSIX.
 *  - TMPDIR keeps mkdtemp colocated with the user's preferred tmp root.
 *
 * Windows essentials are listed separately and only added when the
 * platform check matches; on POSIX they would all be undefined and
 * dropped by the resolver anyway, but listing them for the wrong
 * platform makes the array harder to audit.
 */
export const COMMON_TOOLCHAIN_KEYS = ['PATH', 'HOME', 'LANG', 'TMPDIR'] as const;

/**
 * Windows-specific host-env keys. cmd.exe and the rust/go toolchains
 * derive a lot of behavior from these — without them, even the binary
 * lookup tends to fail.
 */
export const WINDOWS_TOOLCHAIN_KEYS = [
  'SYSTEMROOT',
  'USERPROFILE',
  'PATHEXT',
  'COMSPEC',
] as const;

/**
 * Go-specific host-env keys. GOROOT / GOPATH / GOMODCACHE / GOCACHE /
 * GOTMPDIR cover the toolchain's own cache locations. `GOPROXY` /
 * `GOSUMDB` / `GOFLAGS` / `GOTOOLCHAIN` are intentionally NOT here in
 * v1 — Lingua's hello-world workflow does not fetch external modules,
 * and shipping them silently to the toolchain widens the leak surface.
 * Reintroduce one at a time only when a real smoke breaks without it.
 */
export const GO_TOOLCHAIN_KEYS = [
  'GOROOT',
  'GOPATH',
  'GOMODCACHE',
  'GOCACHE',
  'GOTMPDIR',
] as const;

/**
 * Rust-specific host-env keys. CARGO_HOME / RUSTUP_HOME / RUSTC /
 * CARGO cover toolchain discovery and cache locations.
 * RUSTUP_TOOLCHAIN selects which installed toolchain rustup invokes
 * (stable / nightly / etc.) — it's a toolchain-selection key, NOT a
 * user output flag, so it belongs in the allowlist alongside
 * RUSTUP_HOME. RUSTFLAGS / RUST_BACKTRACE / RUST_LOG remain excluded
 * because they are user-controllable settings that belong in
 * RL-011's user env tier (where the user explicitly opts in), not
 * silently leaked from the host.
 */
export const RUST_TOOLCHAIN_KEYS = [
  'CARGO_HOME',
  'RUSTUP_HOME',
  'RUSTUP_TOOLCHAIN',
  'RUSTC',
  'CARGO',
] as const;

/**
 * RL-019 Slice 2 — Node-specific host-env keys. Node's binary
 * lookup honors `NODE_PATH` for global module resolution; the
 * other allowlisted entries (`NPM_CONFIG_CACHE`, `NPM_CONFIG_PREFIX`)
 * cover the user's local npm / npx layout when the saved tab is
 * inside a project tree. The COMMON allowlist already provides
 * PATH / HOME / LANG / TMPDIR so the runner can find `node` itself
 * and the user's home-rooted caches.
 *
 * Intentionally NOT here in v1: `NODE_OPTIONS`, `NODE_NO_WARNINGS`,
 * `NODE_DEBUG`, `NODE_ENV`. Those are user-controllable knobs that
 * belong in the RL-011 user env tier — silently leaking them from
 * the host widens the surface area in a way that breaks the
 * "trust your toolchain" model.
 */
export const NODE_TOOLCHAIN_KEYS = [
  'NODE_PATH',
  'NPM_CONFIG_CACHE',
  'NPM_CONFIG_PREFIX',
] as const;

/**
 * RL-042 Slice 6 — Ruby-specific host-env keys. Covers:
 *   - `GEM_HOME` / `GEM_PATH` / `BUNDLE_GEMFILE`: per-user gem caches
 *     + bundler context. Without these, system Ruby cannot see gems
 *     the user installed via `gem install --user`.
 *   - `RBENV_VERSION` / `ASDF_RUBY_VERSION`: version-pin selectors so
 *     shims pick the right interpreter. Fold D writes these from a
 *     discovered `.ruby-version` file.
 *   - `RBENV_ROOT` / `RBENV_DIR`: rbenv installation paths so the
 *     shim wrapper can resolve.
 *   - `ASDF_DIR` / `ASDF_DATA_DIR`: same for asdf-vm.
 *
 * Intentionally NOT here: `RUBYOPT`, `RUBYLIB`, `IRBRC`, `RUBYRC`,
 * `RACK_ENV`, `RAILS_ENV`. Those are user-controllable knobs that
 * belong in the RL-011 user env tier (Settings → Environment Variables)
 * — same posture as `NODE_OPTIONS` (excluded above) and `RUSTFLAGS`
 * (excluded above). `RUBYOPT` in particular is a command-line flag
 * injector that would let the host slip arbitrary `-r/some/path` /
 * `-I/another/path` switches into every Ruby spawn; treating it as
 * user-controlled is the conservative posture.
 */
export const RUBY_TOOLCHAIN_KEYS = [
  'GEM_HOME',
  'GEM_PATH',
  'BUNDLE_GEMFILE',
  'RBENV_VERSION',
  'RBENV_ROOT',
  'RBENV_DIR',
  'ASDF_RUBY_VERSION',
  'ASDF_DIR',
  'ASDF_DATA_DIR',
] as const;

/**
 * Build the env passed to `child_process.spawn` / `execFile` for a
 * native runner subprocess. Layering, in order:
 *
 *   1. Pick `toolchainKeys` from `process.env`. Missing keys are
 *      silently dropped — we never emit a key with `undefined`
 *      because Node's `child_process` stringifies that to the literal
 *      `"undefined"` on some platforms, which would silently shadow
 *      a real value the spawned binary might pick up from elsewhere.
 *   2. Merge the RL-011 user env tier on top. Non-string values are
 *      dropped defensively (the renderer's envVarsStore validates
 *      them, but the IPC boundary is untrusted).
 *   3. Apply runner-owned `overrides` last so they always win
 *      (e.g. `GOOS=js` / `GOARCH=wasm`).
 *
 * Tests in `tests/main/nativeEnv.test.ts` pin every layer.
 */
export function buildNativeRunnerEnv(
  toolchainKeys: readonly string[],
  userEnv: Record<string, string> | undefined,
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  const out: Record<string, string> = {};

  for (const key of toolchainKeys) {
    const value = process.env[key];
    if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    }
  }

  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      if (typeof value !== 'string') continue;
      out[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value !== 'string') continue;
    out[key] = value;
  }

  return out;
}

/**
 * Convenience wrapper: combine the common allowlist with the language-
 * specific allowlist, plus Windows essentials when on win32. Returns a
 * concrete string array (not readonly) so callers can spread further.
 */
export function combinedAllowlist(
  languageKeys: readonly string[]
): string[] {
  const platformKeys =
    process.platform === 'win32' ? WINDOWS_TOOLCHAIN_KEYS : ([] as readonly string[]);
  return [...COMMON_TOOLCHAIN_KEYS, ...platformKeys, ...languageKeys];
}
