# Web SQL run lifecycle regression

Cancel received while the first web database handshake is pending must prevent that run's statement from being sent. A result cursor invalidated by a newer run on the same connection must fail rather than report successful EOF. These are two transitions of the web bridge's run lifecycle; the HTTP drivers, desktop SQL host, write guards and connection UI are unchanged.

## Version and fixtures

The failing base (including Copy to Local) is Lingua 1.6.2 at `c894c977005d1447c2fc5550360ffe2c2542ee1f`. Validation uses Node 24.21.0, pnpm 11.3.0, Vitest 5.0.0 and Playwright 1.63.0 / Chromium 153.0.8010.12. Use the committed lockfile, not a dependency update.

The unit fixture injects an in-memory Hrana transport into `createWebSqlDb`: a deferred version reply, synthetic rows and a 10,001-row result. It exercises the actual shared HTTP driver, web bridge and `executeRemoteScript` cursor without fetching anything. The browser fixture intercepts `https://qa.invalid/**`; all other external app requests are fulfilled locally. Tokens are fixed synthetic labels. The browser has a fresh context, disabled clipboard stubs, declined telemetry and blocked service workers.

## Reproduce from this PR checkout

```sh
pnpm --version # 11.3.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/renderer/runtime/sqlWebRunLifecycle.test.ts --maxWorkers=1
pnpm exec vitest run tests/renderer/runtime/sqlWebDb.test.ts tests/renderer/runtime/sqlRemote.test.ts tests/shared/sqlHttp --maxWorkers=1
pnpm exec playwright install chromium
CI=1 node scripts/run-playwright-web-validation.mjs tests/e2e/sqlWebRunLifecycle.spec.ts --workers=1 --retries=0 --trace=on
```

The official browser runner mints a throwaway local signing key, builds with same-origin runtime assets and starts its own strict-port preview on 4175. Keep that port free; do not reuse another app server. `PLAYWRIGHT_BROWSERS_PATH` may point to an owned cache. No real database, issuer, account, clipboard, vault or production token is required. Downloading the official browser is a prerequisite, not a product test.

The EN/light and ES/dark cases open the actual connection UI. The first version reply belongs to the Explorer; the fixture holds the second, belonging to the pending run. Cancel is clicked before that reply is released. Recovery with `SELECT 42 AS answer` provides a completion barrier before asserting that `SELECT 13 AS cancelled_value` was never dispatched. Passing screenshots are attached to the Playwright test result; console/page errors must be empty.

## Before and after

Against the base implementation, the four new unit cases produce three failures and one passing control: the cancelled script reports success and dispatches SQL, pending Cancel answers false, and an invalidated cursor resolves EOF; draining a live cursor still works. With the patch, all four pass. The targeted bridge/remote/HTTP group passes 25 tests.

To repeat the failing-side proof without modifying this checkout, create a disposable baseline worktree and copy only this PR's new test into it:

```sh
git worktree add --detach ../lingua-sql-run-baseline c894c977005d1447c2fc5550360ffe2c2542ee1f
git show HEAD:tests/renderer/runtime/sqlWebRunLifecycle.test.ts > ../lingua-sql-run-baseline/tests/renderer/runtime/sqlWebRunLifecycle.test.ts
pnpm --dir ../lingua-sql-run-baseline install --frozen-lockfile --ignore-scripts
pnpm --dir ../lingua-sql-run-baseline exec vitest run tests/renderer/runtime/sqlWebRunLifecycle.test.ts --maxWorkers=1
```

Expected exit: 1 on that base, 0 on the PR. Preserve any existing work; use a fresh destination.

## Cause and limits

Previously, the bridge registered a waiting run only after `sessionFor()` resolved. Cancel during the handshake had no owner to mark. It now reserves state before awaiting connection and checks it before dispatch and result publication. A missing run in `fetch()` now carries an error message, which the existing remote cursor converts to rejection; a cursor already drained normally still returns EOF.

The shared handshake can continue in the background; this change does not add a connect timeout or abort that transport. It cannot undo a statement already accepted by a server. The invalidated-cursor regression proves the bridge/consumer contract, not every UI export path. No native runtime, desktop IPC, paid feature or signed/notarized release is validated by these web tests. The separate credential-replacement race is outside this patch.
