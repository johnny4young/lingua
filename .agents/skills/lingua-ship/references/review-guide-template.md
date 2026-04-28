# Review Guide template — lingua-ship

Print this block verbatim at Phase 2 step 15, after the closure
report. Substitute the bracketed placeholders. Keep all 9 numbered
sections. Mark `Not applicable` explicitly when a section truly does
not apply (do not silently drop sections — the human relies on the
fixed shape).

```
## Review Guide — RL-XXX

### 1. Automated gates (already green)
Re-run if uncertain:
npm run lint
npx tsc --noEmit
npm run check:i18n
npm run check:i18n:copy
npm test
npm run test:e2e:web         # if touched renderer
npm run smoke:desktop        # if touched IPC / main
npm run test:smoke:web:license   # if touched licensing

Any failure on re-run is a regression after staging — flag it.

### 2. Prerequisite fixes
List every collateral fix with location and reason:
- path/file.ts:L — what was broken and how the fix resolves it.
Write None explicitly if there were no inline fixes.

### 3. Live smoke — Web (if touched renderer)
Start preview:
npm run preview:web
(or npm run dev:web:pro if the surface is Pro-gated and you need to
paste a dev license token first.)

Happy-path trace:
1. Open <route or testid for the feature>.
2. Interact with <concrete testids or controls>.
3. Visually verify <expected result + concrete value>.

Edge cases worth poking manually:
- <empty input>
- <malformed payload>
- <flip locale to es and repeat>

Hard assertion: browser_console_messages level error must be 0 at end
of the pass.

### 4. Live smoke — Electron (if touched IPC / main process)
Start the shell:
npm run dev:desktop          # Free mode
npm run dev:desktop:pro      # Pro mode (mint + paste dev token)
Steps + assertions for the surface touched.

If the ticket is 100% renderer, write Not applicable — covered by
the web smoke.

### 5. Risk areas (look closely)
- path/file.ts:L — why it deserves attention (new algorithm, delicate
  tagged union, possible race, etc.).
Include resolved HIGH findings, deferred MED findings, and any design
decision the reviewer should cross-check against AGENTS.md or an ADR.

### 6. Coupled invariants touched
- tests/components/commandPaletteModel.test.ts — count bumped X to Y.
- tests/shared/appInfo.test.ts — version pin bump.
- tests/web/adapter.test.ts — web stub surface delta.
- any other touched.

### 7. Docs sync checklist
- [ ] docs/ROADMAP.md § 4 Status flip applied
- [ ] docs/SPRINT-PLAN.md § 1 + § N updated
- [ ] docs/PLAN.md Status Update (if applicable)
- [ ] docs/README.md (if new docs created)
- [ ] docs/BACKLOG.md (only if a new requirement surfaced — bugs
      do not go here)

### 8. Quick rollback (if rejecting)
git restore --staged .
git checkout .
Wipes the ticket from the working tree and the index. New files are
deleted too.

### 9. Deferred follow-ups (not staged in this ticket)
- Items added to docs/BACKLOG.md tagged today (requirements only).
- Unresolved MED findings from review.
- Ideas surfaced during implementation that didn't fit scope.
```

After printing the block, run `git status` and `git diff --cached
--stat` one last time so the chat shows the final staged state.

## Notes on placeholder substitution

- `RL-XXX` → the ticket id implemented this slice.
- `<route or testid for the feature>` → concrete identifier from the
  diff (e.g. `/settings/license`, `data-testid="license-paste-input"`).
- `<empty input>` / `<malformed payload>` / `<flip locale to es>` →
  pick the edge cases that match the ticket's real failure modes; do
  not invent generic ones if they're not relevant.
- The bracketed `<X to Y>` count bump applies only when the test was
  actually touched; otherwise drop that bullet.
