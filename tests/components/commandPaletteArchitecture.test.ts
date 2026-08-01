/**
 * Command Palette registry-boundary guard.
 *
 * Included by tsconfig.test.json so the facade type-equivalence probes are
 * compile-time assertions in addition to the runtime architecture checks.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as facade from '../../src/renderer/components/CommandPalette/commandPaletteModel';
import {
  COMMAND_PALETTE_DOMAIN_ORDER,
  COMMAND_PALETTE_REGISTRIES,
} from '../../src/renderer/components/CommandPalette/commandPaletteAssembler';
import type {
  CommandCategory as FacadeCommandCategory,
  CommandEntry as FacadeCommandEntry,
} from '../../src/renderer/components/CommandPalette/commandPaletteModel';
import type {
  CommandCategory,
  CommandEntry,
} from '../../src/renderer/components/CommandPalette/commandPaletteModelTypes';

const repoRoot = path.resolve(__dirname, '../..');
const commandPaletteRoot = path.join(repoRoot, 'src/renderer/components/CommandPalette');

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const compatibilityProbe: [
  Assert<Equal<FacadeCommandCategory, CommandCategory>>,
  Assert<Equal<FacadeCommandEntry, CommandEntry>>,
] = [true, true];

const MODULE_BUDGETS = {
  'commandPaletteModel.ts': 60,
  'commandPaletteAssembler.ts': 80,
  'commandPaletteModelHelpers.ts': 300,
  'commandPaletteModelTypes.ts': 520,
  'commandPaletteRegistries/library.ts': 120,
  'commandPaletteRegistries/workspace.ts': 160,
  'commandPaletteRegistries/artifacts.ts': 500,
  'commandPaletteRegistries/editor.ts': 520,
  'commandPaletteRegistries/application.ts': 220,
  'commandPaletteRegistries/utilities.ts': 130,
} as const;

const HISTORICAL_STATIC_ACTION_ORDER = [
  'action-run-active-tab',
  'action-open-project',
  'action-run-project-tests',
  'action-apply-license',
  'action-rerun-last',
  'action-new-project-from-template',
  'action-restore-session',
  'action-export-capsule',
  'action-import-capsule',
  'action-browse-capsules',
  'action-compare-capsules',
  'action-open-import-overlay',
  'action-export-project-bundle',
  'action-import-project-bundle',
  'action-open-recipes',
  'action-new-notebook',
  'action-export-notebook-linguanb',
  'action-show-language-support',
  'action-copy-language-scorecard-markdown',
  'action-copy-boot-timings',
  'action-copy-share-link',
  'action-replay-onboarding-welcome',
  'action-replay-onboarding-first-run',
  'action-replay-onboarding-first-snippet',
  'action-show-privacy-dashboard',
  'action-show-dependencies',
  'action-toggle-output-source-mapping',
  'action-add-watch',
  'action-focus-stdin-panel',
  'action-toggle-auto-log',
  'action-run-with-extended-timeout',
  'action-toggle-compare-with-snapshot',
  'action-toggle-variable-inspector',
  'action-toggle-vim-mode',
  'action-toggle-inline-lint',
  'action-paste-plain-text',
  'action-toggle-status-bar',
  'action-benchmark-tab',
  'action-install-native-deps',
  'action-explain-last-error',
  'action-explain-selected-code',
  'action-focus-status-bar',
  'action-toggle-presenter-mode',
  'action-layout-horizontal',
  'action-layout-vertical',
  'action-layout-editor',
  'action-snippets',
  'action-runtime-mode-worker',
  'action-runtime-mode-node',
  'action-runtime-mode-browser-preview',
  'action-runtime-mode-deno',
  'action-runtime-mode-bun',
  'action-about',
  'action-whats-new',
  'action-guided-tour',
  'action-settings',
  'action-check-updates',
  'action-restart-update',
  'action-project-search',
  'action-project-replace',
  'action-open-http-workspace',
  'action-open-sql-workspace',
  'action-go-to-symbol',
  'action-keyboard-shortcuts',
  'action-open-file',
  'action-save-as',
  'action-duplicate-tab',
] as const;

function sourceModules(directory: string): string[] {
  const absoluteDirectory = path.join(repoRoot, directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return sourceModules(relativePath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [relativePath] : [];
  });
}

function lineCount(relativePath: string): number {
  return readFileSync(path.join(commandPaletteRoot, relativePath), 'utf8').split('\n').length;
}

function staticActionIds(domain: (typeof COMMAND_PALETTE_DOMAIN_ORDER)[number]): string[] {
  const source = readFileSync(
    path.join(commandPaletteRoot, 'commandPaletteRegistries', `${domain}.ts`),
    'utf8'
  );
  return [...source.matchAll(/buildActionCommand\(\s*'([^']+)'/gu)].map(match => match[1]!);
}

describe('Command Palette domain architecture', () => {
  it('preserves the historical facade API', () => {
    expect(compatibilityProbe).toHaveLength(2);
    expect(Object.keys(facade).sort()).toEqual([
      'buildCommandPaletteModel',
      'filterCommandPaletteCommands',
    ]);
  });

  it('assembles every domain exactly once in the historical order', () => {
    expect(COMMAND_PALETTE_DOMAIN_ORDER).toEqual([
      'library',
      'workspace',
      'artifacts',
      'editor',
      'application',
      'utilities',
    ]);
    expect(Object.keys(COMMAND_PALETTE_REGISTRIES)).toEqual([...COMMAND_PALETTE_DOMAIN_ORDER]);
  });

  it('preserves static action ranking and uniqueness', () => {
    const actionIds = COMMAND_PALETTE_DOMAIN_ORDER.flatMap(staticActionIds);
    expect(actionIds).toEqual([...HISTORICAL_STATIC_ACTION_ORDER]);
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });

  it('keeps every model module within its line budget', () => {
    for (const [module, budget] of Object.entries(MODULE_BUDGETS)) {
      expect(lineCount(module), `${module} exceeds ${budget} lines`).toBeLessThanOrEqual(budget);
    }
  });

  it('keeps production consumers on the stable model facade', () => {
    const internalImportPattern =
      /CommandPalette\/(?:commandPaletteAssembler|commandPaletteModelHelpers|commandPaletteModelTypes|commandPaletteRegistries)/u;
    const internalRoot = 'src/renderer/components/CommandPalette/';
    const internalFiles = new Set([
      `${internalRoot}commandPaletteAssembler.ts`,
      `${internalRoot}commandPaletteModelHelpers.ts`,
      `${internalRoot}commandPaletteModelTypes.ts`,
      ...sourceModules(`${internalRoot}commandPaletteRegistries`),
    ]);
    const offenders = sourceModules('src')
      .filter(module => !internalFiles.has(module))
      .filter(module =>
        internalImportPattern.test(readFileSync(path.join(repoRoot, module), 'utf8'))
      );

    expect(offenders).toEqual([]);
  });
});
