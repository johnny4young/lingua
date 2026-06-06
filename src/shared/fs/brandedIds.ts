/**
 * RL-132 / AUDIT-12 — branded id types for the capability filesystem IPC
 * boundary.
 *
 * Pure module — no Electron, no React, no Node-only APIs — so it imports
 * cleanly from `src/main/ipc/projectCapabilities.ts`, the preload bridge,
 * the renderer's `projectStore.ts`, and `src/types.d.ts` (which re-aliases
 * these brands into the ambient `LinguaAPI` so the renderer sees them
 * without crossing the main/renderer process boundary). The canonical
 * definitions live here; `projectCapabilities.ts` re-exports them so its
 * mint/lookup helpers can hand out branded tokens.
 *
 * Why brands: the three filesystem ids are all `string` at runtime, so
 * nothing stops a caller from passing a `watchId` where a `rootId` is
 * expected, or a `relativePath` where a `rootId` is expected. That swap
 * is the exact shape of a capability-confusion attack at the IPC seam —
 * e.g. feeding the watcher's opaque token into `fs:read` to probe whether
 * it resolves to a different grant. Branding makes each id nominally
 * distinct so a swap is a COMPILE error, caught before it ever ships.
 *
 * COMPILE-TIME ONLY. The `__brand` phantom field never exists at runtime;
 * a `RootId` is just a `string` once the types are erased, so it travels
 * over the structured-clone IPC wire exactly like a plain string with
 * ZERO runtime cost or behavior change. Mint at the real boundary
 * (capability minting in main, preload return casts) and let the brand
 * flow; never reach for `as any` to silence a brand mismatch — that would
 * defeat the swap-attack guard this module exists to provide.
 */

/**
 * Opaque capability token bound to a canonicalized project-root absolute
 * path. Minted by main when the user approves a directory (or the parent
 * of a single picked file); every later `{ rootId, relativePath }` IPC
 * call resolves against the root this token authorizes.
 *
 * Swap-attack invariant: a `WatchId` or a `RelativePath` must NOT be
 * assignable here. Compile-time only — erases to `string` over the wire.
 */
export type RootId = string & { readonly __brand: 'RootId' };

/**
 * Opaque token for an active filesystem watcher registration. The
 * renderer treats it as a black box it can only hand back to
 * `fs:watch-stop`; it is NOT a `RootId` and must never be accepted where
 * a capability `RootId` is expected.
 *
 * Swap-attack invariant: a `RootId` must NOT be assignable here, and a
 * `WatchId` must NOT be assignable to a `RootId`. Compile-time only —
 * erases to `string` over the wire.
 */
export type WatchId = string & { readonly __brand: 'WatchId' };

/**
 * A path relative to a capability's project root. Distinct from the
 * absolute paths main resolves internally and from the id tokens above,
 * so a token can never be passed where a relative path is expected (or
 * vice versa).
 *
 * Swap-attack invariant: a `RootId` / `WatchId` must NOT be assignable
 * here, and a `RelativePath` must NOT be assignable to a `RootId` /
 * `WatchId`. Compile-time only — erases to `string` over the wire.
 */
export type RelativePath = string & { readonly __brand: 'RelativePath' };

/**
 * Cast a raw string to a `RootId`. Use ONLY at a real trust boundary —
 * where main mints a capability, or where the preload bridge re-brands a
 * value main already returned. The cast performs no validation; it is a
 * compile-time assertion that the caller has authorized this string as a
 * root token.
 */
export function asRootId(value: string): RootId {
  return value as RootId;
}

/**
 * Cast a raw string to a `WatchId`. Use ONLY where main mints a watcher
 * registration or where preload re-brands a watcher token it received
 * from main. No runtime validation — compile-time assertion only.
 */
export function asWatchId(value: string): WatchId {
  return value as WatchId;
}

/**
 * Cast a raw string to a `RelativePath`. Use at the boundary where a
 * caller-supplied path string enters the typed surface. No runtime
 * validation — main still re-validates every path inside
 * `resolveCapabilityPath`; this brand only prevents id/path confusion at
 * compile time.
 */
export function asRelativePath(value: string): RelativePath {
  return value as RelativePath;
}
