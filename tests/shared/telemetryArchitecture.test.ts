/**
 * Telemetry module-boundary guard.
 *
 * The historical `src/shared/telemetry.ts` entry point remains the public API,
 * while responsibility modules stay small and internal. This file is included
 * by `tsconfig.test.json`, so the type-equivalence probes are compile gates.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as facade from '../../src/shared/telemetry';
import {
  EVENT_PROPERTY_ALLOWLIST,
  TELEMETRY_EVENTS,
  type TelemetryEventName as CatalogTelemetryEventName,
} from '../../src/shared/telemetry/catalog';
import {
  redactForTelemetry as redactFromBoundary,
  type RedactionResult as BoundaryRedactionResult,
} from '../../src/shared/telemetry/redaction';
import {
  bucketDurationMs as bucketDurationFromBoundary,
  type TelemetryEvent as TransportTelemetryEvent,
} from '../../src/shared/telemetry/transport';
import { CONSOLE_RICH_KIND_BUCKETS } from '../../src/shared/telemetry/valueCatalog';
import type {
  RedactionResult as FacadeRedactionResult,
  TelemetryEvent as FacadeTelemetryEvent,
  TelemetryEventName as FacadeTelemetryEventName,
} from '../../src/shared/telemetry';

const repoRoot = path.resolve(__dirname, '../..');
const sharedRoot = path.join(repoRoot, 'src/shared');
const telemetryRoot = path.join(sharedRoot, 'telemetry');

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const compatibilityProbe: [
  Assert<Equal<FacadeTelemetryEventName, CatalogTelemetryEventName>>,
  Assert<Equal<FacadeTelemetryEvent, TransportTelemetryEvent>>,
  Assert<Equal<FacadeRedactionResult, BoundaryRedactionResult>>,
] = [true, true, true];

const MODULE_BUDGETS = {
  'telemetry.ts': 100,
  'telemetry/catalog.ts': 1_000,
  'telemetry/valueCatalog.ts': 850,
  'telemetry/redaction.ts': 800,
  'telemetry/transport.ts': 120,
} as const;

const HISTORICAL_RUNTIME_EXPORTS = [
  'BOOTSTRAP_FAILURE_REASONS',
  'BOOT_DURATION_BUCKETS',
  'BOOT_PHASES',
  'CAPSULE_BROWSE_SURFACES',
  'CAPSULE_EXPORT_TRIGGERS',
  'CAPSULE_IMPORT_SOURCES',
  'CAPSULE_IMPORT_STATUSES',
  'CAPSULE_SIZE_BUCKETS',
  'CONSOLE_RICH_KIND_BUCKETS',
  'DENY_SUBSTRINGS',
  'DEPENDENCY_COUNT_BUCKETS_SET',
  'DEPENDENCY_INSTALL_FAILURE_REASONS_SET',
  'DEPENDENCY_INSTALL_OUTCOMES_SET',
  'EXTERNAL_RELOAD_MODES',
  'FS_BLOCKED_FAMILIES',
  'FS_DIRECTORY_PICKER_UA_BUCKETS',
  'GIT_LAYER_REPO_STATES',
  'HTTP_METHODS_SET',
  'HTTP_STATUS_BUCKETS_SET',
  'IMAGE_CLIPBOARD_PASTE_STATUSES',
  'IMPORTER_IDS_SET',
  'IMPORT_STATUSES_SET',
  'LANGUAGE_SCORECARD_PLATFORMS',
  'LANGUAGE_SCORECARD_SURFACES',
  'LINT_RULE_IDS',
  'LINT_SEVERITIES',
  'NOTEBOOK_CELL_LANGUAGES_SET',
  'NOTEBOOK_CELL_STATUSES_SET',
  'NOTEBOOK_EXPORT_FORMATS_SET',
  'NOTEBOOK_WARNING_KINDS_SET',
  'ONBOARDING_DISMISS_MODES',
  'ONBOARDING_TOAST_STAGES',
  'OUTPUT_ORIGIN_SURFACES',
  'PIPELINE_RUN_STATUSES_SET',
  'PIPELINE_TEMPLATE_IDS_SET',
  'PRIVACY_DASHBOARD_SURFACES',
  'PROJECT_BUNDLE_EXPORT_STATUSES',
  'PROJECT_BUNDLE_IMPORT_STATUSES',
  'PROJECT_BUNDLE_REJECT_REASONS',
  'RECIPE_RUN_STATUSES_SET',
  'REPLACE_IN_FILES_SCOPES',
  'REVEAL_IN_SC_TARGETS',
  'RICH_MEDIA_REJECTED_KINDS',
  'RICH_MEDIA_REJECTED_REASONS',
  'RUBY_DISPATCHED_MODE_VALUES',
  'RUBY_RUNTIME_PREFERENCE_VALUES',
  'RUBY_SPAWN_BUCKETS',
  'SESSION_RESTORE_SOURCES',
  'SHARE_CREATE_STATUSES',
  'SHARE_CREATE_TRIGGERS',
  'SHARE_OPEN_STATUSES',
  'SHARE_SIZE_BUCKETS_SET',
  'SMART_PASTE_HANDLERS',
  'SQL_DURATION_BUCKETS_SET',
  'SQL_IMPORT_FORMATS_SET',
  'SQL_IMPORT_SOURCES_SET',
  'SQL_QUERY_STATUSES_SET',
  'SQL_STORAGE_MODES_SET',
  'TELEMETRY_EVENTS',
  'TEMPLATE_PROJECT_IDS',
  'bucketBootDuration',
  'bucketDurationMs',
  'bucketOs',
  'createSessionId',
  'isSafeToken',
  'redactForTelemetry',
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
  return readFileSync(path.join(sharedRoot, relativePath), 'utf8').split('\n').length;
}

function telemetryInternalImports(sourceModule: string): string[] {
  const absolutePath = path.join(repoRoot, sourceModule);
  const source = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true);

  return sourceFile.statements.flatMap(statement => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !/(^|\/)shared\/telemetry\//u.test(statement.moduleSpecifier.text)
    ) {
      return [];
    }
    return [statement.moduleSpecifier.text];
  });
}

describe('shared telemetry architecture', () => {
  it('preserves the historical facade types and runtime identities', () => {
    expect(compatibilityProbe).toHaveLength(3);
    expect(Object.keys(facade).sort()).toEqual([...HISTORICAL_RUNTIME_EXPORTS].sort());
    expect(facade.TELEMETRY_EVENTS).toBe(TELEMETRY_EVENTS);
    expect(facade.CONSOLE_RICH_KIND_BUCKETS).toBe(CONSOLE_RICH_KIND_BUCKETS);
    expect(facade.redactForTelemetry).toBe(redactFromBoundary);
    expect(facade.bucketDurationMs).toBe(bucketDurationFromBoundary);
  });

  it('keeps the event and property registries exhaustive', () => {
    expect(Object.keys(EVENT_PROPERTY_ALLOWLIST)).toEqual([...TELEMETRY_EVENTS]);
  });

  it('keeps every responsibility module within its line budget', () => {
    for (const [module, budget] of Object.entries(MODULE_BUDGETS)) {
      expect(lineCount(module), `${module} exceeds ${budget} lines`).toBeLessThanOrEqual(budget);
    }
  });

  it('keeps production consumers on the stable facade', () => {
    const internalModules = new Set(
      sourceModules('src/shared/telemetry').map(module => module.replace(/^src\/shared\//u, ''))
    );
    const offenders = sourceModules('src')
      .filter(module => module !== 'src/shared/telemetry.ts')
      .filter(module => !internalModules.has(module.replace(/^src\/shared\//u, '')))
      .flatMap(sourceModule =>
        telemetryInternalImports(sourceModule).map(specifier => `${sourceModule}: ${specifier}`)
      );

    expect(offenders).toEqual([]);
  });

  it('keeps catalog and transport free of redaction dependencies', () => {
    const catalogSource = readFileSync(path.join(telemetryRoot, 'catalog.ts'), 'utf8');
    const transportSource = readFileSync(path.join(telemetryRoot, 'transport.ts'), 'utf8');

    expect(catalogSource).not.toMatch(/from ['"]\.\/(?:redaction|transport|valueCatalog)['"]/u);
    expect(transportSource).not.toMatch(/from ['"]\.\/(?:redaction|valueCatalog)['"]/u);
  });
});
