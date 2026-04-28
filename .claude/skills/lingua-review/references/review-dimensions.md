# Review dimensions — lingua-review

Cover these dimensions in roughly this order. There is no "out of
scope": if the diff touches a file and a real bug exists there — or
in a file imported by the diff and read for context — count it and
fix it (per the inline-fix policy in `SKILL.md`).

## 1. Logical correctness

The first and highest-priority dimension.

- Off-by-one (loops, slices, paginated cursors).
- Null / undefined paths the type system didn't catch (optional fields
  not optional in usage, JSON.parse results assumed defined).
- Newly-possible impossible states (a switch that no longer covers all
  variants, a tagged union without a `never` tail, a state machine that
  can now reach a forbidden combination).
- Broken invariants (counter doesn't reset, cache key collisions, two
  sources of truth diverging).
- Order-of-operations bugs (await placement, optimistic UI updates
  applied before the server confirmed).

## 2. Security

- Unsanitised input rendered as HTML — React's raw-html escape hatch
  prop, direct `innerHTML` assignment, raw template strings into the
  DOM. Pair with a sanitiser or change to plain text.
- ReDoS-prone regex (catastrophic backtracking patterns).
- Path traversal (joining user input into a filesystem path without
  `path.resolve` plus a sandbox check; main-process only).
- Secrets in logs (license tokens, JWKs, API keys, even partial).
- Timing-unsafe compares (`===` for token equality — should use
  `crypto.timingSafeEqual` or equivalent).
- Downgraded crypto (`md5` for non-collision-resistant uses, `Math.random`
  for security tokens, missing `subtle.verify` calls).
- IPC handlers accepting untrusted shapes without runtime validation.

## 3. Concurrency / races

- Unawaited promises (return value discarded, no `void`, no `.catch`).
- React effects setting state after unmount (no abort signal, no
  cleanup ref, the dreaded `setState on unmounted` warning).
- IPC handlers with collidable request ids (in-flight overlap, last
  writer wins).
- Listeners not removed on cleanup (event-emitter leaks).
- Stale closures in long-lived callbacks (capturing the first render's
  values forever).

## 4. Types

- New `any` (especially the `any` smuggled through `as any` or
  `// @ts-expect-error` without justification).
- Unnecessary type assertions (`as` where the type would have been
  inferred or narrowed correctly).
- Types that lie about runtime shape (a field typed `string` but
  populated with `null` from the API).
- Tagged unions missing the exhaustive `never` tail.
- Generics that don't constrain — `<T>` where `T extends ...` was
  needed.

## 5. Public API vs internal

If an exported signature changes — function arguments, return shape,
component props — every call site must still type-check. Search the
repo for usages and verify nothing else was implicitly broken.

For renderer / shared code split across `src/renderer`, `src/main`,
`src/shared`, watch for the cross-boundary case: changing a shared
type can ripple through both processes.

## 6. Testing

- Real coverage of the delta — assertions, not just line coverage.
- Vacuously-passing tests (no `expect`, or expectations the production
  code makes trivially true).
- Tests asserting implementation detail rather than behaviour
  (snapshotting an internal state machine instead of the UI output).
- Potential flakes (`setTimeout` without fake timers, real network
  calls, dependence on real wall clock).
- Coupled invariants — when bumping a count or a snapshot, confirm
  the bump is semantically justified and not papering over a
  regression.

## 7. i18n

- Hardcoded copy in components — would break `npm run check:i18n:copy`
  on the next gate run.
- Plurals correct with `_one` / `_other` keys.
- en + es parity — every key added in one locale exists in the other.
- Dead keys (added in a previous slice and never removed when the UI
  changed).
- **Voseo leaking into the tuteo Spanish locale** — `Pegá`, `Copiá`,
  `podés`, `querés`. Replace with `Pega`, `Copia`, `puedes`, `quieres`.
  This is an explicit AGENTS.md rule; treat as BLOCKER when found.

## 8. Accessibility

- ARIA roles / labels on interactive elements (custom buttons, custom
  inputs, dialogs, status notices).
- Focus traps in modals (focus stays inside, restored on close).
- Keyboard navigation (Tab order, Enter / Space activation, Esc to
  dismiss).
- Contrast (text vs background, especially in Signal-Slate dark
  surfaces).
- `alt` text on meaningful images, `aria-hidden` on decorative ones.

## 9. Performance

- Unnecessary renders (state updated on every keystroke, refs not used
  for derived values, `useMemo` / `useCallback` missing on expensive
  recomputations).
- Lists without stable keys (`key={index}` on a re-orderable list).
- Uncapped regex (linear-time match assumed; verify on large inputs).
- Heavy synchronous work on the renderer main thread (parsing,
  formatting large strings, full-tree traversals — should be a Web
  Worker or chunked).

## 10. Bundle

- New top-level imports of large libraries that should be `await import(...)`
  inside a handler — don't pull MB into the initial bundle for a code
  path used once.
- Undeclared dependencies (importing a transitive dep — works locally,
  breaks on a clean install).
- Redundant polyfills (importing `core-js` features when the
  build target is modern).

## 11. Docs sync

- ROADMAP / SPRINT-PLAN / PLAN updated when the slice warrants it.
- New ADR / runbook registered in `docs/README.md`.
- BACKLOG only for new requirements without acceptance criteria — bugs
  never go to BACKLOG; they get fixed inline (lingua-ship policy).
- Inline source comments updated when behaviour changed but the comment
  still describes the old behaviour.

## 12. Commit hygiene

Files staged that don't belong to this ticket. Examples:

- A modified `package-lock.json` that wasn't motivated by the diff.
- An unrelated config file picked up by a wide `git add .`.
- Stray editor-config or local IDE files.

**Report them — do not unstage them yourself.** The reviewer's git
policy forbids touching the index. The human decides whether to
unstage via `git restore --staged <path>` or to keep them as
intentional collateral.

## What "fix" means in each dimension

For dimensions 1–10, "fix" usually means editing the source. For
dimensions 11–12, "fix" usually means surfacing in the report so the
human acts. When in doubt, write the fix to the unstaged worktree
and add a rationale comment if the choice was non-obvious.
