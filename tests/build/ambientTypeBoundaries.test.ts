/**
 * Ambient desktop-bridge type boundary guard.
 *
 * `src/types.d.ts` exposes legacy global names to the preload, web adapter,
 * renderer, and tests. Those globals must alias their canonical producer or
 * shared contract instead of structurally copying result unions that can drift.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type { AppInfo as CanonicalAppInfo } from '../../src/shared/appInfo';
import type {
  DependencyInstallLogStream as CanonicalDependencyInstallLogStream,
  DependencyInstallResult as CanonicalDependencyInstallResult,
  DependencyInstallResultStatus as CanonicalDependencyInstallResultStatus,
  DependencyInstallFailureReason as CanonicalDependencyInstallFailureReason,
  DependencyInstallOutcome as CanonicalDependencyInstallOutcome,
  DependencyResolveResult as CanonicalDependencyResolveResult,
  DependencyResolveStatus as CanonicalDependencyResolveStatus,
} from '../../src/shared/dependencies/types';
import type {
  NativeInstallResult as CanonicalNativeInstallResult,
  NativeInstallStatus as CanonicalNativeInstallStatus,
  NativePackageLanguage as CanonicalNativePackageLanguage,
} from '../../src/shared/dependencies/nativeDependencies';
import type { DeepLinkTarget as CanonicalDeepLinkTarget } from '../../src/shared/deepLinks';
import type { FormatIpcResult as CanonicalFormatIpcResult } from '../../src/shared/formatterTypes';
import type {
  GitDetectResult as CanonicalGitDetectResult,
  GitFileDiff as CanonicalGitFileDiff,
  GitFileStatus as CanonicalGitFileStatus,
  GitFileStatusKind as CanonicalGitFileStatusKind,
  GitHeadChangePayload as CanonicalGitHeadChangePayload,
  GitHeadWatcherFailurePayload as CanonicalGitHeadWatcherDiagnostic,
} from '../../src/shared/gitTypes';
import type {
  LicensePayload as CanonicalLicensePayload,
  LicenseVerificationResult as CanonicalLicenseVerificationResult,
} from '../../src/shared/license';
import type {
  LicenseServerDevice as CanonicalLicenseServerDevice,
  LicenseServerDeviceLimit as CanonicalLicenseServerDeviceLimit,
  LicenseServerDevicesBucket as CanonicalLicenseServerDevicesBucket,
  LicenseServerSyncState as CanonicalLicenseServerSyncState,
} from '../../src/shared/licenseServerTypes';
import type {
  LicenseSnapshot as CanonicalLicenseSnapshot,
  LicenseStatus as CanonicalLicenseStatus,
} from '../../src/shared/licenseSnapshot';
import type {
  GoplsStatus as CanonicalGoplsStatus,
  LspLauncherStatus as CanonicalLspLauncherStatus,
  RustAnalyzerStatus as CanonicalRustAnalyzerStatus,
} from '../../src/shared/lspLauncherTypes';
import type {
  AltJsDetectResult as CanonicalAltJsDetectResult,
  AltJsRunKind as CanonicalAltJsRunKind,
  AltJsRunResult as CanonicalAltJsRunResult,
  GoCompileResult as CanonicalGoCompileResult,
  GoDetectResult as CanonicalGoDetectResult,
  NodeDetectResult as CanonicalNodeDetectResult,
  NodeRunKind as CanonicalNodeRunKind,
  NodeRunResult as CanonicalNodeRunResult,
  RubyDetectResult as CanonicalRubyDetectResult,
  RubyRunKind as CanonicalRubyRunKind,
  RubyRunResult as CanonicalRubyRunResult,
  RustDetectResult as CanonicalRustDetectResult,
  RustRunResult as CanonicalRustRunResult,
} from '../../src/shared/nativeRuntimeTypes';

const repoRoot = path.resolve(__dirname, '../..');
const ambientPath = path.join(repoRoot, 'src/types.d.ts');
const SHARED_CONTRACT_BUDGETS = {
  'src/shared/formatterTypes.ts': 40,
  'src/shared/gitTypes.ts': 80,
  'src/shared/licenseSnapshot.ts': 50,
  'src/shared/lspLauncherTypes.ts': 40,
  'src/shared/nativeRuntimeTypes.ts': 120,
} as const;

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const compatibilityProbe: [
  Assert<Equal<GoDetectResult, CanonicalGoDetectResult>>,
  Assert<Equal<GoCompileResult, CanonicalGoCompileResult>>,
  Assert<Equal<RustDetectResult, CanonicalRustDetectResult>>,
  Assert<Equal<RustRunResult, CanonicalRustRunResult>>,
  Assert<Equal<NodeDetectResult, CanonicalNodeDetectResult>>,
  Assert<Equal<NodeRunKind, CanonicalNodeRunKind>>,
  Assert<Equal<NodeRunResult, CanonicalNodeRunResult>>,
  Assert<Equal<RubyDetectResult, CanonicalRubyDetectResult>>,
  Assert<Equal<RubyRunKind, CanonicalRubyRunKind>>,
  Assert<Equal<RubyRunResult, CanonicalRubyRunResult>>,
  Assert<Equal<AltJsDetectResult, CanonicalAltJsDetectResult>>,
  Assert<Equal<AltJsRunKind, CanonicalAltJsRunKind>>,
  Assert<Equal<AltJsRunResult, CanonicalAltJsRunResult>>,
  Assert<Equal<NativePackageLanguage, CanonicalNativePackageLanguage>>,
  Assert<Equal<NativeInstallStatus, CanonicalNativeInstallStatus>>,
  Assert<Equal<NativeInstallResult, CanonicalNativeInstallResult>>,
  Assert<Equal<LspLauncherStatus, CanonicalLspLauncherStatus>>,
  Assert<Equal<RustAnalyzerStatus, CanonicalRustAnalyzerStatus>>,
  Assert<Equal<GoplsStatus, CanonicalGoplsStatus>>,
  Assert<Equal<FormatIpcResult, CanonicalFormatIpcResult>>,
  Assert<Equal<AppInfo, CanonicalAppInfo>>,
  Assert<Equal<DeepLinkTarget, CanonicalDeepLinkTarget>>,
  Assert<Equal<LicensePayloadShape, CanonicalLicensePayload>>,
  Assert<Equal<LicenseVerificationOk, Extract<CanonicalLicenseVerificationResult, { ok: true }>>>,
  Assert<Equal<LicenseStatus, CanonicalLicenseStatus>>,
  Assert<Equal<LicenseServerDevice, CanonicalLicenseServerDevice>>,
  Assert<Equal<LicenseServerDevicesBucket, CanonicalLicenseServerDevicesBucket>>,
  Assert<Equal<LicenseServerDeviceLimit, CanonicalLicenseServerDeviceLimit>>,
  Assert<Equal<LicenseServerSyncState, CanonicalLicenseServerSyncState>>,
  Assert<Equal<LicenseSnapshot, CanonicalLicenseSnapshot>>,
  Assert<Equal<DependencyResolveStatus, CanonicalDependencyResolveStatus>>,
  Assert<Equal<DependencyResolveResult, CanonicalDependencyResolveResult>>,
  Assert<Equal<DependencyInstallResultStatus, CanonicalDependencyInstallResultStatus>>,
  Assert<Equal<DependencyInstallOutcome, CanonicalDependencyInstallOutcome>>,
  Assert<Equal<DependencyInstallFailureReason, CanonicalDependencyInstallFailureReason>>,
  Assert<Equal<DependencyInstallResult, CanonicalDependencyInstallResult>>,
  Assert<Equal<DependencyInstallLogStream, CanonicalDependencyInstallLogStream>>,
  Assert<Equal<GitDetectResult, CanonicalGitDetectResult>>,
  Assert<Equal<GitFileStatusKind, CanonicalGitFileStatusKind>>,
  Assert<Equal<GitFileStatus, CanonicalGitFileStatus>>,
  Assert<Equal<GitFileDiff, CanonicalGitFileDiff>>,
  Assert<Equal<GitHeadChangePayload, CanonicalGitHeadChangePayload>>,
  Assert<Equal<GitHeadWatcherFailurePayload, CanonicalGitHeadWatcherDiagnostic>>,
] = Array.from({ length: 43 }, () => true) as never;

const CANONICAL_ALIAS_NAMES = [
  'GoDetectResult',
  'GoCompileResult',
  'RustDetectResult',
  'RustRunResult',
  'NodeDetectResult',
  'NodeRunKind',
  'NodeRunResult',
  'RubyDetectResult',
  'RubyRunKind',
  'RubyRunResult',
  'AltJsDetectResult',
  'AltJsRunKind',
  'AltJsRunResult',
  'NativePackageLanguage',
  'NativeInstallStatus',
  'NativeInstallResult',
  'LspLauncherStatus',
  'RustAnalyzerStatus',
  'GoplsStatus',
  'FormatIpcResult',
  'AppInfo',
  'DeepLinkTarget',
  'LicensePayloadShape',
  'LicenseVerificationOk',
  'LicenseStatus',
  'LicenseServerDevice',
  'LicenseServerDevicesBucket',
  'LicenseServerDeviceLimit',
  'LicenseServerSyncState',
  'LicenseSnapshot',
  'DependencyResolveStatus',
  'DependencyResolveResult',
  'DependencyInstallResultStatus',
  'DependencyInstallOutcome',
  'DependencyInstallFailureReason',
  'DependencyInstallResult',
  'DependencyInstallLogStream',
  'GitDetectResult',
  'GitFileStatusKind',
  'GitFileStatus',
  'GitFileDiff',
  'GitHeadChangePayload',
  'GitHeadWatcherFailurePayload',
] as const;

describe('ambient desktop bridge type boundaries', () => {
  it('keeps every ambient alias exactly compatible with its canonical contract', () => {
    expect(compatibilityProbe).toHaveLength(43);
  });

  it('keeps canonical bridge names as aliases instead of structural copies', () => {
    const source = readFileSync(ambientPath, 'utf8');
    const sourceFile = ts.createSourceFile(ambientPath, source, ts.ScriptTarget.Latest, true);
    const declarations = new Map(
      sourceFile.statements
        .filter(
          (statement): statement is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
            ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
        )
        .map(statement => [statement.name.text, statement] as const)
    );

    for (const name of CANONICAL_ALIAS_NAMES) {
      const declaration = declarations.get(name);
      expect(declaration, `${name} is missing`).toBeDefined();
      expect(ts.isTypeAliasDeclaration(declaration!), `${name} is a structural copy`).toBe(true);
      expect(
        declaration!.getText(sourceFile),
        `${name} does not point to a shared canonical contract`
      ).toContain("import('./shared/");
    }
  });

  it('keeps the ambient bridge declaration within its review budget', () => {
    const lines = readFileSync(ambientPath, 'utf8').split('\n').length;
    expect(lines).toBeLessThanOrEqual(1_100);
  });

  it('keeps cross-surface contract modules small and independent of app layers', () => {
    for (const [relativePath, budget] of Object.entries(SHARED_CONTRACT_BUDGETS)) {
      const absolutePath = path.join(repoRoot, relativePath);
      const source = readFileSync(absolutePath, 'utf8');
      const sourceFile = ts.createSourceFile(
        absolutePath,
        source,
        ts.ScriptTarget.Latest,
        true
      );
      const imports = sourceFile.statements.filter(ts.isImportDeclaration);

      expect(source.split('\n').length, `${relativePath} exceeds ${budget} lines`).toBeLessThanOrEqual(
        budget
      );
      expect(
        imports.every(statement => statement.importClause?.isTypeOnly),
        `${relativePath} contains a value import`
      ).toBe(true);
      expect(source, `${relativePath} depends on an application layer`).not.toMatch(
        /from ['"]\.\.\/(?:main|preload|renderer)\//u
      );
    }
  });
});
