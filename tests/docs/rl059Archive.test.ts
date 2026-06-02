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
const PLAN_PATH = resolve(__dirname, '../../docs/PLAN.md');
const SPRINT_PLAN_PATH = resolve(__dirname, '../../docs/SPRINT-PLAN.md');
const ARCHIVED_PATH = resolve(__dirname, '../../docs/ARCHIVED.md');
const BACKLOG_PATH = resolve(__dirname, '../../docs/BACKLOG.md');
const AGENTS_PATH = resolve(__dirname, '../../AGENTS.md');

const DONE_ARCHIVE_PATTERN =
  /## 6\. Closed tickets[\s\S]*?<summary><strong>(\d+) `Done` tickets<\/strong>[\s\S]*?<\/details>/u;
const SUPERSEDED_ARCHIVE_PATTERN =
  /<summary><strong>(\d+) `Superseded` tickets<\/strong>[\s\S]*?<\/details>/u;

function getDoneArchiveMatch(roadmap: string): RegExpMatchArray | null {
  return roadmap.match(DONE_ARCHIVE_PATTERN);
}

function getSupersededArchiveMatch(roadmap: string): RegExpMatchArray | null {
  return roadmap.match(SUPERSEDED_ARCHIVE_PATTERN);
}

function collectTicketIds(text: string): string[] {
  return Array.from(text.matchAll(/`(RL-\d{3})`/gu), (match) => match[1]);
}

function collectLeadingBulletTicketIds(text: string): string[] {
  return Array.from(text.matchAll(/^- `(RL-\d{3})`/gmu), (match) => match[1]);
}

describe('ROADMAP — RL-059 archive membership (fold B, 2026-05-12)', () => {
  const roadmap = existsSync(ROADMAP_PATH) ? readFileSync(ROADMAP_PATH, 'utf-8') : '';

  it('RL-059 lives in the §6 Done archive list, not the active backlog', () => {
    // Anchor on the literal `<summary>… Done …</summary>` text so a
    // future extra `<details>` block ahead of the Done list (e.g., a
    // "partially shipped" summary) doesn't terminate the match at
    // the wrong block. Mirrors the same pattern in
    // `tests/docs/envVarsAdr.test.ts`.
    const archiveMatch = getDoneArchiveMatch(roadmap);
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

describe('ROADMAP — RL-142 archive membership (docstring sweep)', () => {
  const roadmap = existsSync(ROADMAP_PATH) ? readFileSync(ROADMAP_PATH, 'utf-8') : '';
  const archived = existsSync(ARCHIVED_PATH) ? readFileSync(ARCHIVED_PATH, 'utf-8') : '';

  it('RL-122 and RL-142 live in the §6 Done archive list, not the active audit table', () => {
    const archiveMatch = getDoneArchiveMatch(roadmap);
    expect(archiveMatch, 'ROADMAP §6 Done archive block not found').not.toBeNull();
    expect(archiveMatch![0]).toMatch(/`RL-122`/u);
    expect(archiveMatch![0]).toMatch(/`RL-142`/u);
    expect(roadmap).not.toMatch(
      /\|\s*\[`RL-122`\]\(\.\/PROJECT_AUDIT_2026_05_24\.md#audit-02[^)]*\)\s*\|/u
    );
    expect(roadmap).not.toMatch(
      /\|\s*\[`RL-142`\]\(\.\/PROJECT_AUDIT_2026_05_24\.md#audit-22[^)]*\)\s*\|/u
    );
    expect(archived).toContain('RL-122');
    expect(archived).toContain('RL-142');
  });
});

describe('ROADMAP archive count hygiene', () => {
  const roadmap = existsSync(ROADMAP_PATH) ? readFileSync(ROADMAP_PATH, 'utf-8') : '';
  const archived = existsSync(ARCHIVED_PATH) ? readFileSync(ARCHIVED_PATH, 'utf-8') : '';

  it('keeps the Done summary count, listed ids, and ARCHIVED.md count in sync', () => {
    const archiveMatch = getDoneArchiveMatch(roadmap);
    expect(archiveMatch, 'ROADMAP §6 Done archive block not found').not.toBeNull();

    const summaryCount = Number(archiveMatch![1]);
    const doneIds = collectTicketIds(archiveMatch![0]);
    const uniqueDoneIds = new Set(doneIds);
    const archivedCount = archived.match(/contains (\d+) `Done`/u)?.[1];

    expect(doneIds).toHaveLength(summaryCount);
    expect(uniqueDoneIds.size).toBe(doneIds.length);
    expect(archivedCount).toBe(String(summaryCount));
  });

  it('keeps ROADMAP active rows disjoint from the Done archive', () => {
    const archiveMatch = getDoneArchiveMatch(roadmap);
    expect(archiveMatch, 'ROADMAP §6 Done archive block not found').not.toBeNull();

    const doneIds = new Set(collectTicketIds(archiveMatch![0]));
    const activeIds = roadmap
      .split('\n')
      .map((line) => line.match(/^\|\s*\[`(RL-\d{3})`\]\([^)]+\)\s*\|/u)?.[1] ?? null)
      .filter((id): id is string => id !== null);
    const overlaps = activeIds.filter((id) => doneIds.has(id));

    expect(overlaps).toEqual([]);
  });

  it('keeps the Superseded summary count aligned and excludes those ids from active rows', () => {
    const supersededMatch = getSupersededArchiveMatch(roadmap);
    expect(supersededMatch, 'ROADMAP superseded archive block not found').not.toBeNull();

    const summaryCount = Number(supersededMatch![1]);
    const supersededIds = collectLeadingBulletTicketIds(supersededMatch![0]);
    const activeIds = roadmap
      .split('\n')
      .map((line) => line.match(/^\|\s*\[`(RL-\d{3})`\]\([^)]+\)\s*\|/u)?.[1] ?? null)
      .filter((id): id is string => id !== null);
    const activeSuperseded = activeIds.filter((id) => supersededIds.includes(id));

    expect(supersededIds).toHaveLength(summaryCount);
    expect(new Set(supersededIds).size).toBe(supersededIds.length);
    expect(supersededIds).toEqual(['RL-012', 'RL-013', 'RL-014', 'RL-015']);
    expect(activeSuperseded).toEqual([]);
    expect(archived).toContain('RL-012');
  });
});

describe('SPRINT-PLAN recommended sequence', () => {
  const sprintPlan = existsSync(SPRINT_PLAN_PATH)
    ? readFileSync(SPRINT_PLAN_PATH, 'utf-8')
    : '';
  const archived = existsSync(ARCHIVED_PATH) ? readFileSync(ARCHIVED_PATH, 'utf-8') : '';

  it('keeps shipped utilities and Go LSP work out of the active pull order', () => {
    expect(sprintPlan).toContain('Archived shipped iterations');
    expect(sprintPlan).toContain('[`ARCHIVED.md`](./ARCHIVED.md)');
    expect(archived).toContain('Closed ticket index');
    expect(sprintPlan).not.toMatch(/\*\*Utilities polish\*\*.+closed in full/u);
    expect(sprintPlan).not.toContain('`RL-026` closed 2026-05-11');
    expect(sprintPlan).not.toContain('`RL-072` remaining QR-read mode');
    expect(sprintPlan).not.toContain('`RL-026` Go via gopls');
  });
});

describe('agent planning guidance', () => {
  const agents = existsSync(AGENTS_PATH) ? readFileSync(AGENTS_PATH, 'utf-8') : '';

  it('points agents at ARCHIVED.md as part of the planning split', () => {
    expect(agents).toContain('docs/ARCHIVED.md');
    expect(agents).toContain('compact archive policy');
    expect(agents).not.toContain('three planning files');
  });
});

describe('ROADMAP active rows', () => {
  const roadmap = existsSync(ROADMAP_PATH) ? readFileSync(ROADMAP_PATH, 'utf-8') : '';
  const plan = existsSync(PLAN_PATH) ? readFileSync(PLAN_PATH, 'utf-8') : '';

  it('documents that audit-promotion rows use PROJECT_AUDIT as their deep scope source', () => {
    expect(roadmap).toContain('audit-promotion tickets (`RL-121..RL-149`)');
    expect(roadmap).toContain('docs/PROJECT_AUDIT_2026_05_24.md');
  });

  it('keeps active backlog rows compact instead of duplicating shipped-slice logs', () => {
    const offenders = roadmap
      .split('\n')
      .filter((line) => line.startsWith('| [`RL-') && line.length > 900)
      .map((line) => {
        const id = line.match(/`(RL-\d{3})`/u)?.[1] ?? 'unknown';
        return `${id}:${line.length}`;
      });

    expect(offenders).toEqual([]);
  });

  it('keeps PLAN top-level statuses aligned with active ROADMAP rows', () => {
    const roadmapStatuses = new Map<string, string>();

    for (const line of roadmap.split('\n')) {
      const match = line.match(
        /^\| \[`(RL-\d{3})`\]\(\.\/PLAN\.md#[^)]+\) \| [^|]+ \| `([^`]+)` \|/u
      );
      if (match) {
        roadmapStatuses.set(match[1], match[2]);
      }
    }

    const planStatuses = new Map<string, string>();
    let currentPlanId: string | null = null;

    for (const line of plan.split('\n')) {
      const headingMatch = line.match(/^### (RL-\d{3})\b/u);
      if (headingMatch) {
        currentPlanId = headingMatch[1];
      }

      if (currentPlanId !== null && !planStatuses.has(currentPlanId)) {
        const statusMatch = line.match(/^- Status: `([^`]+)`/u);
        if (statusMatch) {
          planStatuses.set(currentPlanId, statusMatch[1]);
        }
      }
    }

    const mismatches = Array.from(roadmapStatuses, ([id, roadmapStatus]) => {
      const planStatus = planStatuses.get(id);
      return planStatus === roadmapStatus
        ? null
        : `${id}: PLAN=${planStatus ?? 'missing'} ROADMAP=${roadmapStatus}`;
    }).filter((entry): entry is string => entry !== null);

    expect(mismatches).toEqual([]);
  });
});

describe('BACKLOG raw-capture hygiene', () => {
  const backlog = existsSync(BACKLOG_PATH) ? readFileSync(BACKLOG_PATH, 'utf-8') : '';

  it('keeps raw idea bullets short enough to scan before promotion', () => {
    const bulletBlocks: string[][] = [];
    let currentBlock: string[] | null = null;

    for (const line of backlog.split('\n')) {
      if (line.startsWith('- ')) {
        if (currentBlock !== null) {
          bulletBlocks.push(currentBlock);
        }
        currentBlock = [line];
        continue;
      }

      if (currentBlock !== null && line.startsWith('  ')) {
        currentBlock.push(line);
        continue;
      }

      if (currentBlock !== null) {
        bulletBlocks.push(currentBlock);
        currentBlock = null;
      }
    }

    if (currentBlock !== null) {
      bulletBlocks.push(currentBlock);
    }

    const offenders = bulletBlocks
      .filter((block) => block.join('\n').length > 900)
      .map((block) => {
        const label = block[0].match(/^- \[([^\]]+)\]\s+([^—]+)/u);
        return `${label?.[1] ?? 'unknown'}:${block.join('\n').length}`;
      });

    expect(offenders).toEqual([]);
  });

  it('does not keep promoted planning packets as active raw ideas', () => {
    expect(backlog).not.toContain('World-class candidate packet');
    expect(backlog).not.toContain('Deep project audit 2026-05-24');
    expect(backlog).not.toContain('Planning compaction pass');
  });
});
