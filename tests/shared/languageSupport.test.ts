/**
 * implementation — Language Support Scorecard type contracts.
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
 *   4. JS + TS debugger is `'partial'` per AC (implementation
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
  RUNTIME_CAPABILITIES,
  renderLanguageScorecardMarkdown,
  resolveCapabilityStatus,
  type LanguageSupportProfile,
} from '../../src/shared/languageSupport';

const profileById = (id: string): LanguageSupportProfile =>
  LANGUAGE_SUPPORT_PROFILES.find((profile) => profile.languageId === id)!;

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

  it('JS + TS debugger is marked partial per implementation gate', () => {
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

describe('resolveCapabilityStatus — per-platform resolution ', () => {
  it('is total + pure: every profile × axis × platform yields one stable closed-enum status', () => {
    for (const profile of LANGUAGE_SUPPORT_PROFILES) {
      for (const cap of LANGUAGE_CAPABILITIES) {
        for (const platform of ['web', 'desktop'] as const) {
          const resolved = resolveCapabilityStatus(profile, cap, platform);
          expect(
            LANGUAGE_CAPABILITY_STATUSES,
            `${profile.languageId}.${cap}@${platform} resolved to invalid '${resolved}'`
          ).toContain(resolved);
          // Pure — same inputs return the same output.
          expect(resolveCapabilityStatus(profile, cap, platform)).toBe(resolved);
        }
      }
    }
  });

  it('an explicit perPlatform override always wins (implementation note consistency guard)', () => {
    // Ruby is the canonical override profile. The resolver must surface
    // the declared override verbatim, never a remapped value.
    const ruby = profileById('ruby');
    expect(ruby.perPlatform?.webRuntime?.web).toBe('partial');
    expect(resolveCapabilityStatus(ruby, 'webRuntime', 'web')).toBe('partial');
    expect(ruby.perPlatform?.desktopRuntime?.desktop).toBe('available');
    expect(resolveCapabilityStatus(ruby, 'desktopRuntime', 'desktop')).toBe('available');

    // Whenever a profile declares perPlatform[cap][platform], the resolved
    // value for that (cap, platform) MUST equal the declared override — the
    // resolver can never contradict an explicit author decision.
    for (const profile of LANGUAGE_SUPPORT_PROFILES) {
      for (const cap of LANGUAGE_CAPABILITIES) {
        for (const platform of ['web', 'desktop'] as const) {
          const override = profile.perPlatform?.[cap]?.[platform];
          if (override === undefined) continue;
          expect(
            resolveCapabilityStatus(profile, cap, platform),
            `${profile.languageId}.${cap}@${platform} ignored its perPlatform override`
          ).toBe(override);
        }
      }
    }
  });

  it('never remaps the two runtime axes — they pass through their base status', () => {
    // Lua desktopRuntime is `web-only`: it runs on desktop via the web
    // engine, so it must NOT collapse to `unsupported` on desktop.
    const lua = profileById('lua');
    expect(lua.capabilities.desktopRuntime).toBe('web-only');
    expect(resolveCapabilityStatus(lua, 'desktopRuntime', 'desktop')).toBe('web-only');
    expect(resolveCapabilityStatus(lua, 'desktopRuntime', 'web')).toBe('web-only');
    // Go webRuntime `unsupported` stays unsupported on both platforms.
    const go = profileById('go');
    expect(resolveCapabilityStatus(go, 'webRuntime', 'web')).toBe('unsupported');
    expect(resolveCapabilityStatus(go, 'webRuntime', 'desktop')).toBe('unsupported');
    // Lock the axis set the resolver treats as pass-through.
    expect([...RUNTIME_CAPABILITIES].sort()).toEqual(['desktopRuntime', 'webRuntime']);
  });

  it('collapses desktop-only to unsupported (web) / available (desktop)', () => {
    const go = profileById('go');
    for (const cap of ['lsp', 'packages', 'stdin'] as const) {
      expect(go.capabilities[cap]).toBe('desktop-only');
      expect(resolveCapabilityStatus(go, cap, 'web')).toBe('unsupported');
      expect(resolveCapabilityStatus(go, cap, 'desktop')).toBe('available');
    }
  });

  it('mirrors web-only to available (web) / unsupported (desktop) for non-runtime axes', () => {
    // No shipping profile has a web-only NON-runtime axis today, so assert
    // the mirror behavior via a synthetic profile to lock the contract.
    const lua = profileById('lua');
    const synthetic: LanguageSupportProfile = {
      ...lua,
      capabilities: { ...lua.capabilities, packages: 'web-only' },
    };
    expect(resolveCapabilityStatus(synthetic, 'packages', 'web')).toBe('available');
    expect(resolveCapabilityStatus(synthetic, 'packages', 'desktop')).toBe('unsupported');
  });

  it('returns platform-agnostic statuses unchanged (available/partial/planned/unsupported)', () => {
    // Python packages is `partial` on BOTH platforms — desktop Python is the
    // same Pyodide worker as web (no native pip), so there is no divergence.
    const python = profileById('python');
    expect(python.capabilities.packages).toBe('partial');
    expect(resolveCapabilityStatus(python, 'packages', 'web')).toBe('partial');
    expect(resolveCapabilityStatus(python, 'packages', 'desktop')).toBe('partial');
  });

  it('falls through to the base mapping on the platform an override omits', () => {
    // Synthetic: desktop-only base + a web-only override → web takes the
    // override, desktop falls through to the desktop-only mapping.
    const go = profileById('go');
    const synthetic: LanguageSupportProfile = {
      ...go,
      capabilities: { ...go.capabilities, packages: 'desktop-only' },
      perPlatform: { packages: { web: 'partial' } },
    };
    expect(resolveCapabilityStatus(synthetic, 'packages', 'web')).toBe('partial');
    expect(resolveCapabilityStatus(synthetic, 'packages', 'desktop')).toBe('available');
  });
});

describe('renderLanguageScorecardMarkdown — per-platform (implementation note)', () => {
  it('keeps the header + separator + one-row-per-profile shape for web/desktop', () => {
    for (const platform of ['web', 'desktop'] as const) {
      const lines = renderLanguageScorecardMarkdown(undefined, platform).split('\n');
      expect(lines.length).toBe(2 + LANGUAGE_SUPPORT_PROFILES.length);
      expect(lines[0]).toMatch(/^\| Language \|/);
      expect(lines[1]).toMatch(/^\| --- \|/);
    }
  });

  it('collapses JS packages (desktop-only) to unsupported on web / available on desktop', () => {
    const cell = (platform: 'web' | 'desktop') =>
      renderLanguageScorecardMarkdown(undefined, platform)
        .split('\n')
        .find((line) => line.startsWith('| JavaScript'))!
        .split('|')[7]! // 0='' 1=Language 2=Syntax 3=Auto 4=LSP 5=Web 6=Desktop 7=Packages
        .trim();
    expect(cell('web')).toBe('`unsupported`');
    expect(cell('desktop')).toBe('`available`');
  });

  it('treats a missing platform argument as the default `all` view', () => {
    expect(renderLanguageScorecardMarkdown()).toBe(
      renderLanguageScorecardMarkdown(undefined, 'all')
    );
  });
});
