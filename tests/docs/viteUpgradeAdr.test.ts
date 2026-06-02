/**
 * RL-033 Vite upgrade ADR guard — pins the shipped Vite 8 outcome plus the
 * preserved historical Vite 7 plan so the doc opens with current reality
 * without losing the original risk analysis.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/VITE_UPGRADE_ADR.md');
const MARKETING_ADR_PATH = resolve(__dirname, '../../docs/MARKETING_SITE_ADR.md');

describe('VITE_UPGRADE_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('opens with the shipped Vite 8 outcome, not the superseded Vite 7 plan', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/iu);
    expect(adr).toMatch(/Decision\s*\|\s*Lingua skipped the intermediate Vite 7 hop and shipped the Vite 5 → 8 upgrade/u);
    expect(adr).toMatch(/Current versions\s*\|\s*`vite \^8\.0\.13`/u);
  });

  it('preserves the original Vite 7-over-Vite 8 rationale as historical context', () => {
    expect(adr).toMatch(/## Original rationale: why Vite 7, not Vite 8/u);
    expect(adr).toMatch(/One major at a time/u);
    expect(adr).toMatch(/Superseded 2026-05-17/u);
  });

  it('lists the four blocker peer ranges by name', () => {
    expect(adr).toMatch(/## Original blocker checklist/iu);
    for (const dep of [
      '@electron-forge/plugin-vite',
      '@vitejs/plugin-react',
      'vitest',
      'tailwindcss',
    ]) {
      expect(adr).toContain(dep);
    }
  });

  it('ships an impact matrix that names the load-bearing risk axes', () => {
    expect(adr).toMatch(/## Original impact analysis/u);
    for (const axis of [
      'Bundler (esbuild + Rollup)',
      'esbuild-wasm transpiler',
      'Sass / PostCSS',
      'import.meta.glob',
      'Node target',
    ]) {
      expect(adr).toContain(axis);
    }
  });

  it('verification matrix walks through install, typecheck, lint, tests, web build, desktop dev/smoke, and packaging', () => {
    expect(adr).toMatch(/## Original verification matrix/iu);
    for (const command of [
      'pnpm install',
      'pnpm exec tsc --noEmit',
      'pnpm run lint',
      'pnpm test',
      'pnpm run build:web',
      'pnpm run dev:desktop',
      'pnpm run smoke:desktop',
      'pnpm run make:desktop:mac',
    ]) {
      expect(adr).toContain(command);
    }
  });

  it('rollback plan pins to 5.4.21 via overrides so a future install cannot resolve forward', () => {
    expect(adr).toMatch(/## Original rollback plan/iu);
    expect(adr).toMatch(/5\.4\.21/u);
    expect(adr).toMatch(/overrides/iu);
  });

  it('cross-links the adjacent ADRs', () => {
    for (const pointer of ['BUILD_SYSTEM_ADR.md', 'CAPABILITY_MATRIX.md', 'TAURI_SPIKE_ADR.md']) {
      expect(adr).toContain(pointer);
    }
  });

  // RL-033 Slice 1 — pins the outcome section so the historical Vite 7
  // plan stays preserved alongside the actual Vite 8 result.
  it('records the 2026-05-17 outcome of the bump going straight to Vite 8', () => {
    expect(adr).toMatch(/## Outcome \(2026-05-17\)/u);
    expect(adr).toMatch(/Vite 5 → 8/u);
    expect(adr).toMatch(/`vite`:\s*`\^5\.4\.21`\s*→\s*`\^8\.0\.13`/u);
    expect(adr).toMatch(/`@vitejs\/plugin-react`:\s*`\^4\.7\.0`\s*→\s*`\^6\.0\.2`/u);
    expect(adr).toMatch(/`vitest`:\s*`\^3\.2\.4`\s*→\s*`\^4\.1\.6`/u);
  });

  it('records the prerequisite fixes the bump required', () => {
    expect(adr).toContain('lspIpc.test.ts');
    expect(adr).toContain('run-electron-desktop.mjs');
    expect(adr).toContain('esbuild');
  });

  it('records the dated outcome line in the Reviewers history', () => {
    expect(adr).toMatch(/Outcome recorded:\s*2026-05-17/u);
  });

  it('keeps PLAN status in sync with the shipped RL-033 outcome', () => {
    const plan = readFileSync(resolve(__dirname, '../../docs/PLAN.md'), 'utf-8');
    const rl033 = plan.split('### RL-034')[0]?.split('### RL-033')[1] ?? '';

    expect(rl033).toMatch(/- Status:\s*`Done`/u);
    expect(rl033).toMatch(/Closed 2026-05-17/u);
    expect(rl033).toMatch(/skipped Vite 7 and landed on Vite 8 directly/u);
  });

  it('keeps adjacent Vite-version docs in sync with the shipped upgrade', () => {
    const marketingAdr = readFileSync(MARKETING_ADR_PATH, 'utf-8');

    expect(marketingAdr).toContain('`^8.0.13` here');
    expect(marketingAdr).not.toContain('`^5.4.21` here');
  });
});
