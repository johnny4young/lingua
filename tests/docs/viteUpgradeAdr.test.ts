/**
 * RL-033 Vite upgrade plan guard — pins the impact matrix, the four
 * blocker peer ranges, the verification matrix, and the rollback plan
 * so the bump stays disciplined when someone finally pulls the trigger.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ADR_PATH = resolve(__dirname, '../../docs/VITE_UPGRADE_ADR.md');

describe('VITE_UPGRADE_ADR.md', () => {
  it('exists under docs/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const adr = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('records an accepted "wait, prep, then bump" decision', () => {
    expect(adr).toMatch(/Status\s*\|\s*Accepted/iu);
    expect(adr).toMatch(/Decision\s*\|\s*Plan the Vite 5 → 7 upgrade/u);
  });

  it('explicitly chooses Vite 7 over Vite 8 with a documented rationale', () => {
    expect(adr).toMatch(/## Why Vite 7, not Vite 8/u);
    expect(adr).toMatch(/One major at a time/u);
  });

  it('lists the four blocker peer ranges by name', () => {
    expect(adr).toMatch(/## Blocker checklist/iu);
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
    expect(adr).toMatch(/## Impact analysis/u);
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
    expect(adr).toMatch(/## Verification matrix/iu);
    for (const command of [
      'npm install',
      'npx tsc --noEmit',
      'npm run lint',
      'npm test',
      'npm run build:web',
      'npm run dev:desktop',
      'npm run smoke:desktop',
      'npm run make:desktop:mac',
    ]) {
      expect(adr).toContain(command);
    }
  });

  it('rollback plan pins to 5.4.21 via overrides so a future install cannot resolve forward', () => {
    expect(adr).toMatch(/## Rollback plan/iu);
    expect(adr).toMatch(/5\.4\.21/u);
    expect(adr).toMatch(/overrides/iu);
  });

  it('cross-links the adjacent ADRs', () => {
    for (const pointer of ['BUILD_SYSTEM_ADR.md', 'CAPABILITY_MATRIX.md', 'TAURI_SPIKE_ADR.md']) {
      expect(adr).toContain(pointer);
    }
  });
});
