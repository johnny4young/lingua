/**
 * RL-063 closure guard. The marketing site ships from a separate repo
 * (`johnny4young/lingua-marketing`) per `docs/MARKETING_SITE_ADR.md`.
 * This test pins the cross-repo provenance: the README + RELEASE.md
 * + ROADMAP archive + PLAN.md Status Update + ADR must all stay in
 * sync about that decision so a future contributor cannot quietly
 * drop one of the touchpoints and leave the others claiming the site
 * exists somewhere else.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const README_PATH = resolve(REPO_ROOT, 'README.md');
const RELEASE_PATH = resolve(REPO_ROOT, 'RELEASE.md');
const ROADMAP_PATH = resolve(REPO_ROOT, 'docs/ROADMAP.md');
const PLAN_PATH = resolve(REPO_ROOT, 'docs/PLAN.md');
const DOCS_README_PATH = resolve(REPO_ROOT, 'docs/README.md');
const ADR_PATH = resolve(REPO_ROOT, 'docs/MARKETING_SITE_ADR.md');

const SITE_URL = 'https://linguacode.dev';
const APP_URL = 'https://app.linguacode.dev';
const MARKETING_REPO_SLUG = 'johnny4young/lingua-marketing';
const CASCADE_TICKETS = ['RL-063', 'RL-064', 'RL-066', 'RL-081'] as const;

describe('RL-063 — marketing site cross-repo provenance', () => {
  it('the ADR exists at the expected path', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('the ADR carries Context, Decision, and Consequences sections', () => {
    expect(adr).toMatch(/^## Context/mu);
    expect(adr).toMatch(/^## Decision/mu);
    expect(adr).toMatch(/^## Consequences/mu);
    expect(adr).toMatch(/^## Alternatives considered/mu);
  });

  it('the ADR names the marketing repo, the site URL, and the deployment target', () => {
    expect(adr).toContain(MARKETING_REPO_SLUG);
    expect(adr).toContain(SITE_URL);
    expect(adr).toContain('Cloudflare Pages');
  });

  it('the ADR explicitly declines to pin a commit hash (CF tracks main)', () => {
    // The "no hash pinned" decision is a structural choice — bumping a
    // hash on every deploy would create stale references nobody
    // updates. Lock the rationale into the ADR text. The regex
    // tolerates Markdown backticks around `main` (e.g. "tracks the
    // `main` branch") since the ADR uses inline-code formatting.
    const noHashPattern = /no commit hash[\s\S]+?`?main`?[\s\S]+?branch|main[\s\S]+?branch[\s\S]+?no commit hash/iu;
    expect(adr).toMatch(noHashPattern);
  });

  it('README links to the marketing site and to the ADR', () => {
    expect(existsSync(README_PATH)).toBe(true);
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain(SITE_URL);
    expect(readme).toContain(APP_URL);
    expect(readme).toContain('docs/MARKETING_SITE_ADR.md');
  });

  it('RELEASE.md notes the separate repo + independent deploy cadence', () => {
    expect(existsSync(RELEASE_PATH)).toBe(true);
    const release = readFileSync(RELEASE_PATH, 'utf-8');
    expect(release).toContain(SITE_URL);
    expect(release).toContain(MARKETING_REPO_SLUG);
    expect(release).toContain('docs/MARKETING_SITE_ADR.md');
  });

  it('docs/README.md ADR index registers MARKETING_SITE_ADR with the owning ticket', () => {
    expect(existsSync(DOCS_README_PATH)).toBe(true);
    const docsReadme = readFileSync(DOCS_README_PATH, 'utf-8');
    expect(docsReadme).toContain('MARKETING_SITE_ADR.md');
    expect(docsReadme).toMatch(/MARKETING_SITE_ADR[\s\S]*?RL-063/u);
  });

  it('ROADMAP §6 archive lists all four cascading tickets', () => {
    expect(existsSync(ROADMAP_PATH)).toBe(true);
    const roadmap = readFileSync(ROADMAP_PATH, 'utf-8');
    for (const ticket of CASCADE_TICKETS) {
      // Each ticket must appear inside the comma-separated archive
      // listing. Using a permissive regex so the test is resilient to
      // line wrapping in the listing block.
      expect(roadmap).toMatch(new RegExp(`\`${ticket}\``, 'u'));
    }
  });

  it('ROADMAP §6 archive count is at least 52 (the 48 baseline + the 4 ticket cascade)', () => {
    // The cascade itself bumped 48 → 52. Tickets that close after this
    // slice — RL-082 (2026-05-05) and onwards — push the count higher.
    // Assert the count is 52 or more so this test stops being a
    // ratchet that needs bumping for every unrelated closure, while
    // still defending against an accidental drop.
    const roadmap = readFileSync(ROADMAP_PATH, 'utf-8');
    const countMatch = roadmap.match(/<strong>(\d+) `Done` tickets<\/strong>/u);
    expect(countMatch, 'no archive count pill found in ROADMAP §6').not.toBeNull();
    const count = countMatch ? Number(countMatch[1]) : 0;
    expect(count).toBeGreaterThanOrEqual(52);
  });

  it('ROADMAP active backlog no longer carries any of the four cascading tickets', () => {
    const roadmap = readFileSync(ROADMAP_PATH, 'utf-8');
    // The §4 active sections come before the §6 archive. Slice the
    // file at the archive heading to assert the cascading tickets do
    // NOT appear above it (i.e. they're not in any active table row).
    const archiveAnchor = roadmap.indexOf('## 6. Closed tickets');
    expect(archiveAnchor).toBeGreaterThan(0);
    const activeSection = roadmap.slice(0, archiveAnchor);
    for (const ticket of CASCADE_TICKETS) {
      // The ticket id may still appear in §5 sequence prose (e.g.
      // "RL-063 shipped 2026-05-05"), so we only forbid the table-row
      // form `| [`RL-XXX`](...)` which is unique to the §4 listings.
      const tableRowPattern = new RegExp(`\\|\\s*\\[\`${ticket}\``, 'u');
      expect(activeSection).not.toMatch(tableRowPattern);
    }
  });

  /**
   * Slice PLAN.md into the section that belongs to a given ticket so
   * the per-ticket assertions cannot match against a different
   * ticket's Status Update block. The boundary is the next `### RL-`
   * heading after the target ticket's heading; if no next heading
   * exists, the slice runs to EOF.
   */
  function sliceTicketSection(plan: string, ticket: string): string {
    const startMatch = plan.match(new RegExp(`^### ${ticket}\\b`, 'mu'));
    if (!startMatch || typeof startMatch.index !== 'number') return '';
    const start = startMatch.index;
    const after = plan.slice(start + startMatch[0].length);
    const nextMatch = after.match(/^### RL-\d+\b/mu);
    const end =
      nextMatch && typeof nextMatch.index === 'number'
        ? start + startMatch[0].length + nextMatch.index
        : plan.length;
    return plan.slice(start, end);
  }

  it('PLAN.md carries a Status Update block for each cascading ticket (scoped per section)', () => {
    expect(existsSync(PLAN_PATH)).toBe(true);
    const plan = readFileSync(PLAN_PATH, 'utf-8');
    for (const ticket of CASCADE_TICKETS) {
      const section = sliceTicketSection(plan, ticket);
      expect(section, `no PLAN.md section found for ${ticket}`).not.toBe('');
      // Within the ticket's own section, assert the Status Update
      // block heading exists. Scoping prevents cross-section matches
      // — RL-063's cascade list mentions "closes RL-064" but that
      // would only fire RL-064's assertion if scoping leaked.
      const statusPattern = new RegExp(
        `### Status Update — 2026-05-05[^\\n]*?closes ${ticket}`,
        'u',
      );
      expect(
        section,
        `${ticket} is missing its Status Update block`,
      ).toMatch(statusPattern);
    }
  });

  it('PLAN.md RL-063 Status Update block names the site URL and the marketing repo', () => {
    const plan = readFileSync(PLAN_PATH, 'utf-8');
    const rl063Section = sliceTicketSection(plan, 'RL-063');
    expect(rl063Section, 'RL-063 section not found').not.toBe('');
    expect(rl063Section).toMatch(/### Status Update — 2026-05-05/u);
    expect(rl063Section).toContain(SITE_URL);
    expect(rl063Section).toContain('lingua-marketing');
  });
});
