# Filesystem denylist (`BLOCKED_PATHS`)

> Living reference for the renderer-facing filesystem path denylist. Unlike the
> dated packets in this folder, this file tracks the current policy and is
> updated whenever the denylist changes. Source of truth:
> `src/main/ipc/permissions.ts`. Ticket: RL-137 / AUDIT-17.

## Why

Lingua's renderer can open and save files the user picks. The capability
sandbox (`src/main/ipc/projectCapabilities.ts`) already binds every operation to
an opaque `rootId` + relative path and `realpath`-verifies containment. The
denylist is **defense-in-depth on top of that**: even a path the user explicitly
picks (or a previously-approved root that is restored on launch) is refused when
it falls inside a protected family, so a misdirected open/save cannot read or
overwrite OS internals, the user's credentials, other apps' data, browser
profiles, or Lingua's own stored state.

## Families

Every blocked entry carries a `BlockedPathFamily` (the `BLOCKED_PATH_FAMILIES`
tuple). The family drives the actionable, localized denial notice and a
privacy-safe `fs.blocked` telemetry signal that carries **only** the family
token — never the path.

| Family | Covers | Examples |
| --- | --- | --- |
| `system` | OS roots | `/etc`, `/usr`, `/System`, `/private`; Windows `%SystemRoot%`, `%ProgramFiles%` |
| `credentials` | Key material / cloud creds | `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/Library/Keychains` |
| `app-data` | Broad app-data roots (incl. nested browser profiles + Lingua's own data on macOS/Windows) | `~/Library/Application Support`, `~/Library/Safari`, `~/Library/Containers`, `%APPDATA%` (`~/AppData/Roaming`) |
| `browser-profile` | Browser profiles NOT under the broad app-data roots | `%LOCALAPPDATA%\Google\Chrome`, `…\Microsoft\Edge`, `…\BraveSoftware`, `…\Chromium`, `~/.config/google-chrome`, `~/.config/chromium`, `~/.config/microsoft-edge`, `~/.config/BraveSoftware`, `~/.mozilla` |
| `lingua-data` | Lingua's own electron-owned dirs, registered at startup | `app.getPath('userData' / 'sessionData' / 'logs')` |

### Why some entries are broad

`~/Library/Application Support` (macOS) and `~/AppData/Roaming` (Windows
`%APPDATA%`) are intentionally broad. They cover most application state, the
Chromium-family browser profiles nested under them, **and** Lingua's own
userData in a single entry. A code runner has no legitimate reason to let a user
open/save into another app's state directory through a file dialog, so the
breadth is the desired posture, not collateral.

### `lingua-data` is registered, not hard-coded

Lingua's own data dirs are resolved from electron's `app` at startup via
`registerBlockedPaths([...])` rather than guessed from the app name. This keeps
`permissions.ts` electron-free and unit-testable while still blocking the real
on-disk paths on every OS. (On macOS/Windows the `app-data` roots already cover
userData; the registration also catches the Linux `~/.config/<app>` location and
`sessionData` / `logs`.)

## Enforcement layers

1. **Pickers** (`fs:select-directory` / `fs:select-file` / `fs:save-dialog`)
   call `blockedPathFamily(chosen)` and refuse a blocked pick, naming the family
   in the error.
2. **Capability chokepoint** (`resolveCapabilityPath`) re-applies the denylist
   AND `realpath`-resolves the candidate, verifying containment against the
   `realpath` of the root. This is where **symlink-escape** is defeated: a
   symlink inside an allowed dir that points at a blocked/outside target is
   rejected after resolution (covered by the symlink cases in
   `tests/ipc/fileSystem.test.ts`).

### Matching is lexical in `isPathBlocked`, by design

`isPathBlocked` / `blockedPathFamily` match lexically (canonicalize +
path-segment prefix). They do **not** `realpath` the target, for two reasons:
the capability layer already does symlink resolution at the right place, and a
`realpath` pass here would over-block — on macOS `os.tmpdir()` lives under
`/var/folders`, and `/var` firmlinks into the blocked `/private`, so resolving
symlinks in the denylist would wrongly reject every temp path.

## User-facing denial

A blocked reopen/pick surfaces an actionable status notice
(`fs.error.blockedPath[.<family>]`, en + es) telling the user to pick a path
inside their project, and emits `fs.blocked { family }`. The family token is the
only data on the wire; the path never leaves the device.

## Extending the denylist

1. Add a `{ family, path }` entry to `STATIC_BLOCKED_PATHS` in
   `src/main/ipc/permissions.ts` (or a new family token to
   `BLOCKED_PATH_FAMILIES`).
2. Add a positive + negative case to the family matrix in
   `tests/ipc/permissions.test.ts`.
3. If you add a family token, mirror it in `FS_BLOCKED_FAMILIES`
   (`src/shared/telemetry.ts` + `update-server/src/telemetry.ts`) and add a
   `fs.error.blockedPath.<family>` notice key (en + es). The parity tests fail
   closed if any copy drifts.
