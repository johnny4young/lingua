/**
 * RL-011 ADR guard — pins the three scoping decisions (which runtimes
 * accept env vars, web mode answer, scope precedence) so the
 * implementation slices can't ship against the wrong policy.
 *
 * Also pins (fold B of the 2026-05-12 close-out) that ROADMAP's §6
 * Done archive lists RL-011, so a future revert that flips it back
 * to Partial without ADR justification fails CI before it ships.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/ENV_VARS_ADR.md');
const ROADMAP_PATH = resolve(__dirname, '../../docs/ROADMAP.md');

describe('ENV_VARS_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted decision plus a date', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/i);
    expect(adr).toMatch(/Date\s*\|\s*2026-04-20/u);
  });

  it('answers the three RL-011 scoping questions', () => {
    expect(adr).toMatch(/## Decisions/u);
    // Q1: runtimes
    expect(adr).toMatch(/### 1\. Runtimes that receive env vars/iu);
    for (const runtime of ['Go', 'Rust', 'Python', 'JavaScript Worker', 'TypeScript Worker']) {
      expect(adr).toContain(runtime);
    }
    // Q2: web
    expect(adr).toMatch(/### 2\. Web mode/iu);
    expect(adr).toMatch(/No env vars in web mode/iu);
    // Q3: scope precedence
    expect(adr).toMatch(/### 3\. Scope: tab > project > global/u);
    expect(adr).toMatch(/Tab keys override project, project keys override global/u);
  });

  it('blocks the secret-storage scope creep explicitly', () => {
    expect(adr).toMatch(/No secret-storage UI/iu);
    expect(adr).toMatch(/Lingua is a scratchpad, not a vault/u);
  });

  it('lists the four implementation slices A through D with current status', () => {
    for (const slice of ['Slice A', 'Slice B', 'Slice C', 'Slice D']) {
      expect(adr).toContain(slice);
    }
  });

  it('cross-links the adjacent ADRs and RL items', () => {
    for (const pointer of [
      'BUILD_SYSTEM_ADR.md',
      'CAPABILITY_MATRIX.md',
      'LANGUAGE_PACK_ADR.md',
      'RL-029',
      'RL-058',
    ]) {
      expect(adr).toContain(pointer);
    }
  });
});

describe('ROADMAP — RL-011 archive membership (fold B, 2026-05-12)', () => {
  const roadmap = existsSync(ROADMAP_PATH) ? readFileSync(ROADMAP_PATH, 'utf-8') : '';

  it('RL-011 lives in the §6 Done archive list, not the active backlog', () => {
    // The §6 archive is a fenced `<details>` block containing a
    // comma-separated list of Done ids. Anchor on the literal
    // `<summary>… Done tickets …</summary>` text inside the block
    // so that if §6 ever gains an extra `<details>` block ahead of
    // the Done list (e.g., a "partially shipped" summary), this
    // assertion still resolves to the right block instead of
    // terminating at the first stray `</details>`.
    const archiveMatch = roadmap.match(
      /## 6\. Closed tickets[\s\S]*?<summary>[\s\S]*?Done[\s\S]*?<\/summary>[\s\S]*?<\/details>/u
    );
    expect(archiveMatch, 'ROADMAP §6 Done archive block not found').not.toBeNull();
    expect(archiveMatch![0]).toMatch(/`RL-011`/u);
  });

  it('RL-011 is NOT listed in any §4 active-backlog table row', () => {
    // §4 active-backlog rows for `RL-XXX` have the canonical shape:
    //   `| [`RL-XXX`](./PLAN.md#…) | <title> | `<status>` | … |`
    // A row for RL-011 in §4 would mean the close-out got reverted
    // or someone reintroduced it as Partial. The ADR's "Workers do
    // not receive env vars" decision would need to be repealed
    // before reopening the ticket, so failing here is intentional.
    const activeRowPattern = /\|\s*\[`RL-011`\]\(\.\/PLAN\.md#rl-011[^)]*\)\s*\|/u;
    expect(roadmap).not.toMatch(activeRowPattern);
  });
});
