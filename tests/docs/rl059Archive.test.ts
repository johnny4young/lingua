/**
 * RL-059 close-out guard (fold B, 2026-05-12) — mirrors the fold-B
 * archive-membership pattern landed for RL-011 in `envVarsAdr.test.ts`.
 *
 * Locks the close-out: RL-059 must live in ROADMAP §6 Done archive
 * and must NOT appear as an active-backlog row in any §4 section.
 * A future revert that flips it back to Partial without
 * justification (the named remaining scope shipped under RL-061
 * which is already Done) fails CI before it ships.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROADMAP_PATH = resolve(__dirname, '../../docs/ROADMAP.md');
const SPRINT_PLAN_PATH = resolve(__dirname, '../../docs/SPRINT-PLAN.md');

describe('ROADMAP — RL-059 archive membership (fold B, 2026-05-12)', () => {
  const roadmap = existsSync(ROADMAP_PATH) ? readFileSync(ROADMAP_PATH, 'utf-8') : '';

  it('RL-059 lives in the §6 Done archive list, not the active backlog', () => {
    // Anchor on the literal `<summary>… Done …</summary>` text so a
    // future extra `<details>` block ahead of the Done list (e.g., a
    // "partially shipped" summary) doesn't terminate the match at
    // the wrong block. Mirrors the same pattern in
    // `tests/docs/envVarsAdr.test.ts`.
    const archiveMatch = roadmap.match(
      /## 6\. Closed tickets[\s\S]*?<summary>[\s\S]*?Done[\s\S]*?<\/summary>[\s\S]*?<\/details>/u
    );
    expect(archiveMatch, 'ROADMAP §6 Done archive block not found').not.toBeNull();
    expect(archiveMatch![0]).toMatch(/`RL-059`/u);
  });

  it('RL-059 is NOT listed in any §4 active-backlog table row', () => {
    // §4 active-backlog rows for `RL-XXX` have the canonical shape:
    //   `| [`RL-XXX`](./PLAN.md#…) | <title> | `<status>` | … |`
    // A row for RL-059 in §4 would mean the close-out got reverted
    // or someone reintroduced it as Partial without an ADR-grade
    // justification. The named remaining scope (Polar webhook +
    // email delivery) shipped under RL-061 (Done), so failing here
    // is intentional.
    const activeRowPattern = /\|\s*\[`RL-059`\]\(\.\/PLAN\.md#rl-059[^)]*\)\s*\|/u;
    expect(roadmap).not.toMatch(activeRowPattern);
  });
});

describe('SPRINT-PLAN recommended sequence', () => {
  const sprintPlan = existsSync(SPRINT_PLAN_PATH)
    ? readFileSync(SPRINT_PLAN_PATH, 'utf-8')
    : '';

  it('does not list shipped utilities or Go LSP work as remaining pulls', () => {
    expect(sprintPlan).toMatch(/\*\*Utilities polish\*\*.+closed in full/u);
    expect(sprintPlan).toContain('`RL-026` closed 2026-05-11');
    expect(sprintPlan).not.toContain('`RL-072` remaining QR-read mode');
    expect(sprintPlan).not.toContain('`RL-026` Go via gopls');
  });
});
