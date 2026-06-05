/**
 * RL-130 (AUDIT-10) structure guard — locks the web/desktop seam split so a
 * future edit cannot silently regress it. Mirrors the RL-128/RL-129 guards.
 *
 * - fold C (public API barrel): the assembled store exposes EXACTLY the
 *   `LicenseState` surface (7 state fields + 5 actions); `licenseStore.ts`
 *   exposes exactly the `useLicenseStore` runtime export; and the four public
 *   types still re-export from the facade (compile-time guard — `export type`
 *   re-exports are erased at runtime, so they cannot be asserted via Object.keys).
 * - fold D (size budget): the facade stays thin and no extracted module grows
 *   back toward a monolith.
 * - fold E (import acyclicity): no module imports the facade; the type/mapper/
 *   verify/token leaves never import an action factory or a store; and the web
 *   and desktop stores never import each other (the seam stays clean).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as licenseStoreModule from '../../src/renderer/stores/licenseStore';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import type {
  LicenseState,
  LicenseStatus,
  RecoverHint,
  ServerSyncState,
} from '../../src/renderer/stores/licenseStore';

const STORES_DIR = resolve(__dirname, '../../src/renderer/stores');

/** The complete `LicenseState` surface — 7 state fields + 5 actions. */
const EXPECTED_STORE_KEYS = [
  'token',
  'status',
  'lastVerifiedAt',
  'serverSync',
  'devices',
  'deviceLimit',
  'recoverHint',
  'setLicenseToken',
  'revalidate',
  'clearLicense',
  'removeDevice',
  'clearRecoverHint',
].sort();

const STATE_FIELDS = new Set([
  'token',
  'status',
  'lastVerifiedAt',
  'serverSync',
  'devices',
  'deviceLimit',
  'recoverHint',
]);

/** The only RUNTIME export of the facade (the four public types are erased). */
const EXPECTED_RUNTIME_EXPORTS = ['useLicenseStore'];

const ASSEMBLY_FILE = 'licenseStore.ts';
const ASSEMBLY_MAX_LINES = 60;

const SPLIT_MODULES = [
  'licenseTypes.ts',
  'licenseBridge.ts',
  'licenseServerMappers.ts',
  'licenseTokenHelpers.ts',
  'licenseWebVerify.ts',
  'licenseWebActions.ts',
  'licenseWebRevalidate.ts',
  'licenseWebStore.ts',
  'licenseDesktopStore.ts',
];
const MODULE_MAX_LINES = 300;

/** Leaves: must reach neither the facade, an action factory, nor a store module. */
const LEAF_MODULES = [
  'licenseTypes.ts',
  'licenseBridge.ts',
  'licenseServerMappers.ts',
  'licenseTokenHelpers.ts',
  'licenseWebVerify.ts',
];
const ACTION_FACTORY_MODULES = ['licenseWebActions.ts', 'licenseWebRevalidate.ts'];
const STORE_MODULES = ['licenseWebStore.ts', 'licenseDesktopStore.ts'];

function read(file: string): string {
  return readFileSync(resolve(STORES_DIR, file), 'utf8');
}

function lineCount(file: string): number {
  return read(file).split('\n').length;
}

function importsModule(source: string, moduleFile: string): boolean {
  const moduleName = moduleFile.replace(/\.ts$/, '');
  return new RegExp(`from\\s+['"]\\./${moduleName}['"]`).test(source);
}

describe('RL-130 licenseStore split — public API barrel (fold C)', () => {
  it('the assembled store exposes exactly the LicenseState surface', () => {
    const keys = Object.keys(useLicenseStore.getState()).sort();
    expect(keys).toEqual(EXPECTED_STORE_KEYS);
  });

  it('every non-state member is an action function', () => {
    const state = useLicenseStore.getState() as unknown as Record<string, unknown>;
    for (const key of EXPECTED_STORE_KEYS) {
      if (STATE_FIELDS.has(key)) continue;
      expect(typeof state[key], `${key} should be an action function`).toBe('function');
    }
  });

  it('licenseStore.ts exposes exactly useLicenseStore at runtime', () => {
    expect(Object.keys(licenseStoreModule).sort()).toEqual(EXPECTED_RUNTIME_EXPORTS);
  });

  it('still re-exports the four public types from the facade (compile-time)', () => {
    // If any `export type { … } from './licenseTypes'` were dropped, this file
    // would fail to type-check. The runtime assertion is a formality.
    const probe: [LicenseStatus, ServerSyncState, RecoverHint, LicenseState] | null = null;
    expect(probe).toBeNull();
  });
});

describe('RL-130 licenseStore split — size budget (fold D)', () => {
  it('the facade stays thin', () => {
    expect(lineCount(ASSEMBLY_FILE)).toBeLessThanOrEqual(ASSEMBLY_MAX_LINES);
  });

  it.each(SPLIT_MODULES)('%s stays under the per-module budget', (file) => {
    expect(lineCount(file)).toBeLessThanOrEqual(MODULE_MAX_LINES);
  });
});

describe('RL-130 licenseStore split — import acyclicity (fold E)', () => {
  it.each([...SPLIT_MODULES])('%s does not import the facade', (file) => {
    expect(read(file)).not.toMatch(/from\s+['"]\.\/licenseStore['"]/);
  });

  it.each(LEAF_MODULES)('%s is a leaf — no action-factory or store imports', (file) => {
    const source = read(file);
    for (const dependent of [...ACTION_FACTORY_MODULES, ...STORE_MODULES]) {
      expect(
        importsModule(source, dependent),
        `${file} must not import ${dependent}`
      ).toBe(false);
    }
  });

  it('the web and desktop stores never import each other (seam stays clean)', () => {
    expect(importsModule(read('licenseWebStore.ts'), 'licenseDesktopStore.ts')).toBe(false);
    expect(importsModule(read('licenseDesktopStore.ts'), 'licenseWebStore.ts')).toBe(false);
  });
});
