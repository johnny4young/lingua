/**
 * implementation — client-side cloud sync engine for user artifacts (snippets,
 * settings, themes, keymaps).
 *
 * This is the transport-independent core: a pure last-write-wins merge
 * with delete tombstones and conflict reporting, plus a thin `syncOnce`
 * orchestrator that pulls a remote snapshot, merges it against the local
 * one, and pushes the result back through an injected `SyncTransport`.
 *
 * The transport is an interface so the engine is fully unit-testable with
 * an in-memory fake and so the real backend (a Cloudflare Worker keyed by
 * license, mirroring `license-server`) can drop in without touching this
 * logic. Wiring a concrete HTTPS transport and the Settings → Sync surface
 * is a follow-up work; per the audit rules the server side is a proposal,
 * not an applied change.
 *
 * Scope note: only the user's OWN artifacts sync, to the user's OWN
 * account. Timestamps are milliseconds-since-epoch supplied by the caller
 * (injected clock) so the merge stays pure and deterministic in tests.
 */

export interface SyncEntry<T = unknown> {
  /** The artifact payload (snippet body, setting value, theme JSON, …). */
  value: T;
  /** Last-modified time in ms since epoch. Drives last-write-wins. */
  updatedAt: number;
  /** Tombstone: a deletion that must propagate to the other side. */
  deleted?: boolean;
}

/** A full snapshot of one artifact collection, keyed by stable item id. */
export type SyncSnapshot<T = unknown> = Record<string, SyncEntry<T>>;

export interface SyncConflict {
  key: string;
  /** Which side's entry won the merge. */
  winner: 'local' | 'remote';
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export interface MergeResult<T = unknown> {
  merged: SyncSnapshot<T>;
  conflicts: SyncConflict[];
  /** `true` when the merged result differs from the remote snapshot. */
  changedFromRemote: boolean;
}

function entriesDiffer(a: SyncEntry, b: SyncEntry): boolean {
  return (
    a.updatedAt !== b.updatedAt ||
    Boolean(a.deleted) !== Boolean(b.deleted) ||
    JSON.stringify(a.value) !== JSON.stringify(b.value)
  );
}

function snapshotsDiffer(a: SyncSnapshot, b: SyncSnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const ea = a[key];
    const eb = b[key];
    if (!ea || !eb) return true;
    if (entriesDiffer(ea, eb)) return true;
  }
  return false;
}

/**
 * Keys that, assigned via bracket notation, mutate the target's prototype
 * chain instead of adding a data property. A remote snapshot is untrusted
 * input (it comes off `transport.pull()`), so a `{"__proto__": …}` entry must
 * never reach the merge object.
 */
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Merge two snapshots with last-write-wins per key. On a timestamp tie the
 * LOCAL entry wins, so a just-made local edit is never silently clobbered
 * by an equally-timestamped remote. A conflict is recorded whenever both
 * sides hold an entry for a key and their contents differ.
 */
export function mergeSnapshots<T>(
  local: SyncSnapshot<T>,
  remote: SyncSnapshot<T>
): MergeResult<T> {
  // Null-prototype so a stray `__proto__` key can only ever be an own data
  // property, never a prototype-chain mutation.
  const merged: SyncSnapshot<T> = Object.create(null) as SyncSnapshot<T>;
  const conflicts: SyncConflict[] = [];
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);

  for (const key of keys) {
    if (PROTO_POLLUTION_KEYS.has(key)) continue; // drop prototype-polluting keys
    const l = local[key];
    const r = remote[key];
    if (l && !r) {
      merged[key] = l;
      continue;
    }
    if (r && !l) {
      merged[key] = r;
      continue;
    }
    if (!l || !r) continue; // unreachable, satisfies the checker

    // Both sides present.
    const localWins = l.updatedAt >= r.updatedAt;
    merged[key] = localWins ? l : r;
    if (entriesDiffer(l, r)) {
      conflicts.push({
        key,
        winner: localWins ? 'local' : 'remote',
        localUpdatedAt: l.updatedAt,
        remoteUpdatedAt: r.updatedAt,
      });
    }
  }

  return {
    merged,
    conflicts,
    changedFromRemote: snapshotsDiffer(merged, remote),
  };
}

/**
 * Drop tombstones once both sides have converged, so deleted entries do
 * not accumulate forever. A tombstone is only safe to prune after it has
 * propagated — callers apply this to the FINAL merged snapshot they
 * persist locally, not to the one they push (the push must carry the
 * tombstone so the other device sees the delete).
 */
export function pruneTombstones<T>(snapshot: SyncSnapshot<T>): SyncSnapshot<T> {
  const out: SyncSnapshot<T> = Object.create(null) as SyncSnapshot<T>;
  for (const [key, entry] of Object.entries(snapshot)) {
    if (PROTO_POLLUTION_KEYS.has(key)) continue;
    if (!entry.deleted) out[key] = entry;
  }
  return out;
}

export interface SyncTransport<T = unknown> {
  /** Fetch the current remote snapshot (empty object when none yet). */
  pull(): Promise<SyncSnapshot<T>>;
  /** Replace the remote snapshot with `snapshot`. */
  push(snapshot: SyncSnapshot<T>): Promise<void>;
}

export interface SyncOutcome<T = unknown> {
  merged: SyncSnapshot<T>;
  conflicts: SyncConflict[];
  /** `true` when a push actually happened (merged differed from remote). */
  pushed: boolean;
}

/**
 * Run one sync round: pull → merge → push-if-changed. Returns the merged
 * snapshot the caller should persist locally plus any conflicts for the
 * UI. Never throws for a benign empty remote; transport errors propagate
 * so the caller can surface an offline/unreachable state.
 */
export async function syncOnce<T>(
  local: SyncSnapshot<T>,
  transport: SyncTransport<T>
): Promise<SyncOutcome<T>> {
  const remote = await transport.pull();
  const { merged, conflicts, changedFromRemote } = mergeSnapshots(local, remote);
  if (changedFromRemote) {
    await transport.push(merged);
  }
  return { merged, conflicts, pushed: changedFromRemote };
}
