# Inline-fix policy — lingua-ship

During Phase 2, unrelated bugs may surface: a gate breaking for an
unrelated reason, a stale path after a reorg, a forgotten dependency,
broken tests that aren't yours, stale imports, a config out of sync
with the repo, dead branches in a tagged union, etc.

## Default rule — fix inline, no threshold

If it is a real observable bug, fix it inline. No line threshold, no
file threshold, no asking. The ticket scope absorbs the fix and the
work continues. Flag the fix clearly in the report and the suggested
commit message so the human has traceability.

`docs/BACKLOG.md` is reserved for **new requirements without
acceptance criteria** (features, ideas, explorations, pending
decisions). Bugs never go to BACKLOG; they get fixed now.

When applying an inline fix:

- Add the paths to the same `git add` as the ticket so everything
  lands in one coherent staging.
- In the chat report, add a `Prerequisite fixes` section with the bug,
  the fix, why it surfaced, and the approximate lines/files touched.
- In the suggested commit message, list the fix as a separate bullet
  at the top of the body prefixed `- prerequisite:`. It is labelling
  for traceability, not an invitation to split — the commit stays
  single.

## Carve-outs — stop and report instead of fixing

Three situations override the default. Stop, surface in chat, wait
for human input.

### 1. Design change

The Phase 1-approved approach no longer holds — the chosen library
doesn't work, the expected API doesn't exist, the pattern contradicts
AGENTS.md, the data shape demands a different abstraction. That's a
decision for the human, not a fix.

What to do: post the conflict, propose 1-3 alternatives with
trade-offs, wait. Do not silently pivot.

### 2. Ambiguous acceptance criteria

The fix forces a decision PLAN.md / ROADMAP doesn't make explicit.
Examples: which tier should gate the new flow; should the empty state
show a CTA or a hint; should the failure mode retry silently or
surface a toast.

What to do: pause and ask. One concrete question, propose a default,
wait for confirmation.

### 3. Security or privacy

The bug exposes a vulnerability — credential leak, XSS via raw HTML
injection, path traversal, timing-unsafe compare, downgraded crypto,
PII written to logs, etc. — surface for human input before touching.

What to do: report the vulnerability with severity assessment, do not
attempt a fix without explicit acknowledgement. The human may want to
treat it as a separate hotfix commit, or rotate a credential, or
notify someone before code lands.

## Not a reason to stop

Incidental-with-scope mixing that's "hard to separate" is **not** a
reason to stop. If the fix can sit in distinct hunks from the ticket
work, fix it inline and let the human decide at review time whether
to split via `git add -p`.

A "this could be cleaner" instinct is also not a reason to fix —
opportunistic refactors of adjacent files outside the ticket scope
are out per the hard restrictions in SKILL.md.

## Why this shape

Real bugs that block gates have to be fixed anyway. Accumulating them
as "follow-up tickets" creates phantom debt that slows future slices
and clutters ROADMAP. The carve-out for design / AC / security is the
escape hatch where the agent's autonomy correctly stops — those need a
human decision, not a Claude one.
