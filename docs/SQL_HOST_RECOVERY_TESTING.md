# SQL host restart ownership

## Contract and root cause

A request queued on a replacement SQL host must survive the retired host's later
`exit` event. Restart already rejects the retired generation's pending requests.
Only the current child may clear the supervisor and fail current requests.

Previously `UtilityProcess.kill()` returned, a replacement request was queued,
and the old child's asynchronous exit rejected that replacement with
`The SQL host stopped.`. The next request could succeed. This occurs after the
SQLite cancellation/timeout path restarts a busy synchronous host. The change is
limited to ownership of the exit event; active-host crashes still fail pending
requests, and existing timeouts and restart behavior remain intact.

Base: Lingua 1.6.2, `c894c977005d1447c2fc5550360ffe2c2542ee1f`.
Validated tooling: Node 24.21.0, pnpm 11.3.0, Vitest 5.0.0;
native fixture Electron 44.3.0, embedded Node 24.20.0 / SQLite 3.53.4.
The fixture verifies the actual Electron version against the installed project pin.

## Deterministic unit regression

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/main/sqlHostSupervisor.test.ts --maxWorkers=1
```

The added case models `kill()` returning before `exit`: restart the first child,
queue a replacement request, deliver the old exit, then the new reply. On the
base this produces **one failure and three passing controls**. With the fix all
four pass. No timer increase, arbitrary sleep, server or credential is needed.

## Native SQLite fixture

Review the launcher and fixture before execution. Use a disposable checkout and
the project's official Electron binary, never an installed Lingua application.
If the frozen `--ignore-scripts` installation omitted Electron's binary, inspect
`node_modules/electron/install.js` and provision that pinned official binary in
the isolated environment, or pass its verified absolute path explicitly.

```sh
node scripts/build-desktop-bundles.mjs
node scripts/smoke-sql-host-recovery.mjs
# Alternatively, use a verified official project Electron binary:
node scripts/smoke-sql-host-recovery.mjs --electron-executable /absolute/path/to/Electron
```

The launcher creates an owned temporary SQLite file and application/profile,
compiles only the fixture bootstrap, clears inherited environment, and requests
mock credential storage. It creates no browser windows, starts no normal app,
uses no clipboard/keyring APIs, registers no protocol and connects to no server.
The SQL host opens only the synthetic file read-only. Three iterations warm a
host, start a bounded long SELECT, restart it, immediately queue SELECT 42 on the
replacement and require its result. The previous pending request must fail as
part of restart; that expected failure is recorded separately. A watchdog ends
only the spawned fixture app. Temporary artifacts remain for review.

Before the fix the native fixture exits 1 with `SqlHostError: The SQL host stopped.`;
the SQLite checksum remains unchanged. After the fix it must report `passed`,
three successful replacement cases and `unchanged: true`. App versions and host
spawn/exit evidence are in `report.json`; stdout prints its artifact directory.
This is functional recovery qualification, not a performance benchmark or a
signed/notarized release check.

## Recreate the failing base

From a checkout of this PR, copy only its fixtures into a separate base worktree:

```sh
git worktree add --detach ../lingua-host-base c894c977005d1447c2fc5550360ffe2c2542ee1f
for file in tests/main/sqlHostSupervisor.test.ts tests/__fixtures__/sqlHostRecoveryMain.ts scripts/smoke-sql-host-recovery.mjs; do
  mkdir -p "../lingua-host-base/$(dirname "$file")"
  git show "HEAD:$file" > "../lingua-host-base/$file"
done
cd ../lingua-host-base
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/main/sqlHostSupervisor.test.ts --maxWorkers=1
node scripts/build-desktop-bundles.mjs
node scripts/smoke-sql-host-recovery.mjs --electron-executable /absolute/path/to/official/project/Electron
```

The product supervisor remains the base implementation. Retain both failures,
then run the same commands in the separate PR checkout for the passing side.
Do not reset an original checkout or reuse a real app profile.

## Scope and limitations

The regression protects the supervisor's contract for all engines; SQLite makes
the native reproduction self-contained. It does not change driver cancellation,
add a connect timeout, undo accepted writes, repair cursor EOF handling or alter
the browser bridge. Normal interactive EN/ES cancellation/recovery was also
exercised independently; the lost immediate request was confirmed at the native
service/supervisor boundary, not asserted to occur on every UI click sequence.
