# Web SQL credential and session ownership regression

An older request's authentication failure must not erase a replacement credential that already works. Credential replacement must also detach the old main/catalog/edit lanes before awaiting their closure, so a late finalizer cannot delete a newer lane. This patch changes only ownership within the browser database bridge; it does not change credential persistence, permissions, SQL classification or HTTP driver protocols.

## Version and fixtures

The failing base (including Copy to Local) is Lingua 1.6.2 at `c894c977005d1447c2fc5550360ffe2c2542ee1f`. Validation uses Node 24.21.0, pnpm 11.3.0, Vitest 5.0.0 and Playwright 1.63.0 / Chromium 153.0.8010.12, from the committed lockfile.

The in-memory Hrana fixture supplies every reply and records synthetic token labels. No network or real credential is involved. Cases cover a held old catalog handshake returning 401 after a successful replacement run, old main-handshake cleanup versus a replacement catalog cache, token A→B→A, capture before the opening microtask, and a currently refused credential that must still be forgotten.

## Reproduce from this PR checkout

```sh
pnpm --version # 11.3.0
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run tests/renderer/runtime/sqlWebSessionOwnership.test.ts --maxWorkers=1
pnpm exec vitest run tests/renderer/runtime/sqlWebDb.test.ts tests/renderer/runtime/sqlRemote.test.ts tests/shared/sqlHttp --maxWorkers=1
pnpm exec playwright install chromium
CI=1 node scripts/run-playwright-web-validation.mjs tests/e2e/sqlWebSessionOwnership.spec.ts --workers=1 --retries=0 --trace=on
```

Keep the runner's strict-port preview on 4175 free; it must not reuse another session's server. It builds same-origin runtime assets and mints only a throwaway local signing key. `PLAYWRIGHT_BROWSERS_PATH` may select an owned cache. The browser fixture has a fresh context, disabled clipboard stubs, declined telemetry and blocked service workers. All external app requests are fulfilled locally, including `https://qa.invalid/**`; no database or production service is contacted.

The EN/light and ES/dark UI cases perform this sequence:

1. Add the synthetic connection; hold its old Explorer version request.
2. Run `SELECT 42 AS answer`; the old main credential receives an injected 401 and opens the password prompt.
3. Enter the replacement label and verify successful output 42 before releasing the old catalog response.
4. Release that response as another 401, wait until the Explorer has processed the error, then run again. The replacement must still work with no password prompt.

Exactly the injected HTTP-401 resource messages from the reserved endpoint are allowed; page exceptions and other console errors must be empty. The stale catalog may show its request error with Retry. Preserving the valid credential does not mean hiding that older error. Screenshots before and after late refusal are attached to passing tests.

## Before and after

On the base, the five new unit cases produce four failures and one passing control. A late refusal clears the replacement, old cleanup invalidates its catalog, a same-text replacement is mistaken for the old credential, and the opening microtask reads the newer secret. Current-credential refusal already works. With the patch all five pass; the targeted bridge/remote/HTTP group passes 26 tests.

For a disposable failing-side proof from the PR checkout:

```sh
git worktree add --detach ../lingua-sql-credential-baseline c894c977005d1447c2fc5550360ffe2c2542ee1f
git show HEAD:tests/renderer/runtime/sqlWebSessionOwnership.test.ts > ../lingua-sql-credential-baseline/tests/renderer/runtime/sqlWebSessionOwnership.test.ts
pnpm --dir ../lingua-sql-credential-baseline install --frozen-lockfile --ignore-scripts
pnpm --dir ../lingua-sql-credential-baseline exec vitest run tests/renderer/runtime/sqlWebSessionOwnership.test.ts --maxWorkers=1
```

Expected exit: 1 on the base, 0 on the PR. Use a fresh worktree destination and preserve other work.

## Cause and limits

Previously, `refused()` unconditionally deleted secrets by connection id. A per-replacement identity now ties failure handling to the revision that an operation used, even if token text repeats. Opening captures its secret before the microtask. Cleanup snapshots/removes every old lane synchronously, then awaits only those detached promises. Current authentication failures still clear their own credential and request a password again.

This change does not abort an in-flight connection handshake, retry stale requests, hide an old catalog error, change the desktop vault/SQL host, or implement the separate pending-run Cancel/cursor repair. Native execution, real clipboard/Keychain, paid services and signed/notarized packaging are outside the validation scope. Both SQL repairs are independently based on the same main commit; review and test their combination before merging both.
