/**
 * RL-095 Slice 1 — Language Support Scorecard type contracts.
 *
 * Asserts the coupled invariants that keep `LANGUAGE_SUPPORT_PROFILES`
 * honest:
 *
 *   1. Every true-runtime `LanguagePack` (`execution` is `'run'` or
 *      `'compile'`) has exactly one matching profile entry. `validate`
 *      and `view` packs sit outside the scorecard scope by design.
 *   2. Every profile references a real `LanguagePack.id` (no typos).
 *   3. Every profile fills all nine capabilities (the
 *      `Record<LanguageCapability, ...>` shape catches this at
 *      compile time, but the assertion documents the contract).
 *   4. JS + TS debugger is `'partial'` per AC (RL-027 Slice 1.5b
 *      gated under security review).
 *   5. `renderLanguageScorecardMarkdown` produces a stable shape
 *      (header + separator + N data rows).
 */

import { describe, expect, it } from 'vitest';
import { LANGUAGE_PACKS } from '../../src/shared/languagePacks';
import {
  LANGUAGE_CAPABILITIES,
  LANGUAGE_CAPABILITY_STATUSES,
  LANGUAGE_SUPPORT_PROFILES,
  renderLanguageScorecardMarkdown,
} from '../../src/shared/languageSupport';

const PROFILE_IDS = new Set(
  LANGUAGE_SUPPORT_PROFILES.map((profile) => profile.languageId)
);
const PACK_IDS = new Set(LANGUAGE_PACKS.map((pack) => pack.id));

describe('LANGUAGE_SUPPORT_PROFILES — coupled invariants', () => {
  it('every true-runtime LanguagePack (run | compile) has exactly one profile entry', () => {
    // The scorecard tracks languages with a real execution backend
    // (`run` or `compile`). `validate`-class packs (linting-only, e.g.
    // dockerfile, gitignore, json) and `view` packs (read-only, e.g.
    // toml, ini) intentionally do not appear — they have no runtime,
    // package manager, or debugger to score.
    const runtimePacks = LANGUAGE_PACKS.filter(
      (pack) => pack.execution === 'run' || pack.execution === 'compile'
    );
    const missing = runtimePacks
      .filter((pack) => !PROFILE_IDS.has(pack.id))
      .map((pack) => pack.id);
    expect(
      missing,
      missing.length > 0
        ? `Add a LanguageSupportProfile entry for: ${missing.join(', ')} in src/shared/languageSupport.ts`
        : 'no missing'
    ).toEqual([]);
  });

  it('every profile references a real LanguagePack.id (no typos)', () => {
    const orphaned = LANGUAGE_SUPPORT_PROFILES.filter(
      (profile) => !PACK_IDS.has(profile.languageId)
    ).map((profile) => profile.languageId);
    expect(
      orphaned,
      orphaned.length > 0
        ? `Profile entries reference unknown pack ids: ${orphaned.join(', ')}`
        : 'no orphans'
    ).toEqual([]);
  });

  it('every profile fills all nine capability axes', () => {
    for (const profile of LANGUAGE_SUPPORT_PROFILES) {
      for (const capability of LANGUAGE_CAPABILITIES) {
        const status = profile.capabilities[capability];
        expect(
          LANGUAGE_CAPABILITY_STATUSES,
          `Profile '${profile.languageId}' has invalid status '${String(status)}' for capability '${capability}'`
        ).toContain(status);
      }
    }
  });

  it('JS + TS debugger is marked partial per RL-027 Slice 1.5b gate', () => {
    const js = LANGUAGE_SUPPORT_PROFILES.find(
      (profile) => profile.languageId === 'javascript'
    );
    const ts = LANGUAGE_SUPPORT_PROFILES.find(
      (profile) => profile.languageId === 'typescript'
    );
    expect(js?.capabilities.debugger).toBe('partial');
    expect(ts?.capabilities.debugger).toBe('partial');
  });

  it('every profile with perPlatform overrides references known capabilities', () => {
    for (const profile of LANGUAGE_SUPPORT_PROFILES) {
      if (!profile.perPlatform) continue;
      for (const cap of Object.keys(profile.perPlatform)) {
        expect(LANGUAGE_CAPABILITIES).toContain(cap);
      }
    }
  });
});

describe('renderLanguageScorecardMarkdown', () => {
  it('produces header + separator + one row per profile', () => {
    const md = renderLanguageScorecardMarkdown();
    const lines = md.split('\n');
    // 1 header + 1 separator + N data rows
    expect(lines.length).toBe(2 + LANGUAGE_SUPPORT_PROFILES.length);
    expect(lines[0]).toMatch(/^\| Language \|/);
    expect(lines[1]).toMatch(/^\| --- \|/);
  });

  it('emits each profile in array order with status cells as inline code', () => {
    const md = renderLanguageScorecardMarkdown();
    const lines = md.split('\n').slice(2); // skip header + separator
    for (let i = 0; i < LANGUAGE_SUPPORT_PROFILES.length; i += 1) {
      const profile = LANGUAGE_SUPPORT_PROFILES[i]!;
      const line = lines[i]!;
      expect(line).toContain(`| ${profile.displayName} |`);
      expect(line).toContain('`' + profile.capabilities.syntax + '`');
    }
  });

  it('renders deterministically when called twice', () => {
    const a = renderLanguageScorecardMarkdown();
    const b = renderLanguageScorecardMarkdown();
    expect(a).toBe(b);
  });
});
