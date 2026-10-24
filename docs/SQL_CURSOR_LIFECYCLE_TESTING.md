# Desktop SQL cursor lifecycle

## Contract

A missing, explicitly closed or invalidated owner-scoped cursor returns a generic
closed-result error, not successful EOF. A live cursor remains readable by its
owner. Another caller gets no rows and cannot consume that owner's cursor.

The SQL host already rejects a missing run. Main's service previously returned an
empty successful page before asking the host when its own run map lacked the key.
A newer run or explicit close therefore bypassed the host's error. The existing
renderer cursor rejects `errorMessage`; this change preserves that error across
the service boundary instead of allowing partial data to appear complete to a
stale caller.

Base: Lingua 1.6.2, `c894c977005d1447c2fc5550360ffe2c2542ee1f`.
Tooling: Node 24.21.0, pnpm 11.3.0, Vitest 5.0.0 / SQLite 3.53.4.
Independent native observations used Electron 44.3.0 / Node 24.20.0 with the same
SQLite version and a synthetic read-only file.

## Reproducible regression

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/main/sqlDbClosedCursor.test.ts --maxWorkers=1
pnpm exec vitest run tests/main/sqlDbService.test.ts tests/main/sqlHost/host.test.ts tests/main/sqlHostSupervisor.test.ts tests/main/sqlHostProcess.test.ts --maxWorkers=1
```

The checked-in fixture creates its own temporary database with 15,000 integer
rows, opens it read-only through the real SQLite driver and SQL host, and uses
the production connection catalog and service. Only the supervisor's transport is
adapted to call the host in-process; no live server, native vault or password is
used. Canonical paths keep `/tmp` and `/private/tmp` aliases within the same
fixture-only boundary. Cleanup closes host sessions and removes only the
fixture's own directory.

Four cases cover:

1. A live owned cursor continues (passing control on the base).
2. A newer run invalidates the previous window (base lacks `errorMessage`).
3. Explicit close makes further fetch fail (base lacks `errorMessage`).
4. An unknown owner gets a generic error, while the real owner still reads rows
   (base returns successful EOF to the unknown owner).

Base result: **three failures, one passing control**. Patched result: **four
passed**. Refusals return no rows, run ID, connection details or other owner's
SQL. Existing driver errors and valid EOF from a cursor's final read are unchanged.

## Recreate the failing base

From the PR checkout:

```sh
git worktree add --detach ../lingua-cursor-base c894c977005d1447c2fc5550360ffe2c2542ee1f
git show HEAD:tests/main/sqlDbClosedCursor.test.ts > ../lingua-cursor-base/tests/main/sqlDbClosedCursor.test.ts
cd ../lingua-cursor-base
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/main/sqlDbClosedCursor.test.ts --maxWorkers=1
```

Only the new test is copied, so product code is still the base implementation.
Run the same command in the separate PR checkout for the passing side.

## Limits and related behavior

This is a service/bridge contract regression with a real synthetic SQLite engine,
not a claim that every UI path loses data. The current SQL runner proactively
closes its single active cursor when replacing it, so many interactive flows
never attempt the stale read. Native EN/ES success/error/cancel/read-only
journeys were checked separately. No production database or user data was used.

The change does not alter session authorization, driver protocols, database
contents, cancellation, host restart ownership, web credentials or the browser
bridge. A stale caller receives an error rather than silently treating missing
rows as completion. No new permission or release version is introduced.
