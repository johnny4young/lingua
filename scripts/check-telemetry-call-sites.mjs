import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const TELEMETRY_HOOK_PATH = 'src/renderer/hooks/useTelemetry.ts';

/**
 * RL-149 leaves the non-React and lower-traffic call-site long tail for later
 * sweeps. Each value is a ceiling, not a target: deleting or migrating calls is
 * always allowed, while adding a new direct caller or increasing a ceiling is
 * rejected. The only unrestricted entry point is useTelemetry itself.
 */
export const LEGACY_DIRECT_CALL_LIMITS = Object.freeze({
  'src/renderer/components/AppOverlays.tsx': 1,
  'src/renderer/components/CapsuleList/CapsuleListOverlay.tsx': 3,
  'src/renderer/components/CommandPalette/useCommandPaletteCommands.ts': 2,
  'src/renderer/components/Console/RichValueError.tsx': 1,
  'src/renderer/components/Console/RichValueHtml.tsx': 1,
  'src/renderer/components/Console/RichValueImage.tsx': 1,
  'src/renderer/components/Debugger/DebuggerDrawer.tsx': 1,
  'src/renderer/components/DeveloperUtilities/UtilityHistoryDrawer.tsx': 2,
  'src/renderer/components/Editor/CompareToggleButton.tsx': 1,
  'src/renderer/components/Editor/RecentRunsPill.tsx': 2,
  'src/renderer/components/Editor/VariableInspectorToggleButton.tsx': 1,
  'src/renderer/components/ProjectReplace/ProjectReplace.tsx': 2,
  'src/renderer/components/Settings/AppearanceSection.tsx': 1,
  'src/renderer/components/Settings/EditorSection.tsx': 2,
  'src/renderer/components/Settings/ExecutionHistorySection.tsx': 1,
  'src/renderer/components/Settings/LanguageSupportScorecard.tsx': 3,
  'src/renderer/components/Settings/PrivacySection.tsx': 2,
  'src/renderer/components/Settings/PrivacyTrustSection.tsx': 1,
  'src/renderer/components/Settings/UtilitiesSection.tsx': 2,
  'src/renderer/components/Toolbar/Toolbar.tsx': 1,
  'src/renderer/hooks/autoRunExecution.ts': 1,
  'src/renderer/hooks/autoRunResult.ts': 3,
  'src/renderer/hooks/gitTelemetry.ts': 5,
  'src/renderer/hooks/globalShortcutUtilities.ts': 1,
  'src/renderer/hooks/httpWorkspaceTelemetry.ts': 1,
  'src/renderer/hooks/importTelemetry.ts': 3,
  'src/renderer/hooks/notebookTelemetry.ts': 4,
  'src/renderer/hooks/projectBundleTelemetry.ts': 3,
  'src/renderer/hooks/projectTemplateTelemetry.ts': 1,
  'src/renderer/hooks/recipeTelemetry.ts': 2,
  'src/renderer/hooks/sqlWorkspaceTelemetry.ts': 4,
  'src/renderer/hooks/useAppShortcuts.ts': 2,
  'src/renderer/hooks/useCapsuleImport.ts': 1,
  'src/renderer/hooks/useInlineLint.ts': 1,
  'src/renderer/hooks/useSessionRestoreBoot.ts': 3,
  'src/renderer/hooks/utilityPipelineTelemetry.ts': 1,
  'src/renderer/runners/env.ts': 1,
  'src/renderer/runners/javascript.ts': 5,
  'src/renderer/runners/nodeRunner.ts': 2,
  'src/renderer/runners/python.ts': 3,
  'src/renderer/runners/ruby.ts': 1,
  'src/renderer/runners/typescript.ts': 5,
  'src/renderer/runtime/executeTabManually.ts': 4,
  'src/renderer/stores/editorCloseActions.ts': 1,
  'src/renderer/stores/editorModeActions.ts': 3,
  'src/renderer/stores/editorSaveActions.ts': 2,
  'src/renderer/stores/editorTabActions.ts': 2,
  'src/renderer/stores/editorWorkspaceActions.ts': 1,
  'src/renderer/stores/persistence/migrationRegistry.ts': 1,
  'src/renderer/stores/settingsRuntimeActions.ts': 5,
  'src/renderer/stores/snippetsStore.ts': 1,
  'src/renderer/stores/updateStore.ts': 1,
  'src/renderer/utils/blockedPath.ts': 1,
  'src/renderer/utils/bootTimings.ts': 1,
  'src/renderer/utils/exportCapsule.ts': 1,
  'src/renderer/utils/exportCapsuleHtml.ts': 1,
  'src/renderer/utils/shareLink.ts': 2,
});

function rendererSourceFiles(rootDir) {
  const rendererDir = path.join(rootDir, 'src', 'renderer');
  if (!fs.existsSync(rendererDir)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) files.push(absolute);
    }
  };
  visit(rendererDir);
  return files;
}

function targetsTelemetryEmitter(moduleSpecifier, fileName) {
  if (!moduleSpecifier.startsWith('.')) {
    return moduleSpecifier.endsWith('utils/telemetry');
  }
  const resolved = path.resolve(path.dirname(fileName), moduleSpecifier);
  return resolved.endsWith(path.join('src', 'renderer', 'utils', 'telemetry'));
}

function directTrackEventCallCount(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const localNames = new Set();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!targetsTelemetryEmitter(statement.moduleSpecifier.text, fileName)) continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    for (const element of imports.elements) {
      if ((element.propertyName ?? element.name).text === 'trackEvent') {
        localNames.add(element.name.text);
      }
    }
  }

  const collectDynamicImportBindings = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'then' &&
      ts.isCallExpression(node.expression.expression) &&
      node.expression.expression.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const importCall = node.expression.expression;
      const moduleSpecifier = importCall.arguments[0];
      const callback = node.arguments[0];
      if (
        moduleSpecifier &&
        ts.isStringLiteral(moduleSpecifier) &&
        targetsTelemetryEmitter(moduleSpecifier.text, fileName) &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
      ) {
        const parameter = callback.parameters[0]?.name;
        if (parameter && ts.isObjectBindingPattern(parameter)) {
          for (const element of parameter.elements) {
            if (element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
            const importedName = element.propertyName ?? element.name;
            if (ts.isIdentifier(importedName) && importedName.text === 'trackEvent') {
              localNames.add(element.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, collectDynamicImportBindings);
  };
  collectDynamicImportBindings(sourceFile);

  let count = 0;
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      localNames.has(node.expression.text)
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

export function scanDirectTelemetryCalls(rootDir) {
  const calls = new Map();
  for (const absolute of rendererSourceFiles(rootDir)) {
    const relative = path.relative(rootDir, absolute).split(path.sep).join('/');
    const count = directTrackEventCallCount(
      fs.readFileSync(absolute, 'utf8'),
      absolute
    );
    if (count > 0) calls.set(relative, count);
  }
  return calls;
}

export function auditDirectTelemetryCalls(
  rootDir,
  limits = LEGACY_DIRECT_CALL_LIMITS
) {
  const calls = scanDirectTelemetryCalls(rootDir);
  const issues = [];
  for (const [file, count] of calls) {
    if (file === TELEMETRY_HOOK_PATH) continue;
    const ceiling = limits[file];
    if (ceiling === undefined) {
      issues.push(
        `${file}: ${count} direct trackEvent call(s); route React callers through useTelemetry()`
      );
    } else if (count > ceiling) {
      issues.push(
        `${file}: ${count} direct trackEvent call(s), legacy ceiling is ${ceiling}`
      );
    }
  }
  for (const [file, ceiling] of Object.entries(limits)) {
    const count = calls.get(file) ?? 0;
    if (count < ceiling) {
      issues.push(
        `${file}: ${count} direct trackEvent call(s), legacy ceiling is ${ceiling}; lower or remove the stale ceiling`
      );
    }
  }
  return { calls, issues };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { calls, issues } = auditDirectTelemetryCalls(process.cwd());
  if (issues.length > 0) {
    console.error('Telemetry call-site audit failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    const legacyCount = [...calls.entries()]
      .filter(([file]) => file !== TELEMETRY_HOOK_PATH)
      .reduce((total, [, count]) => total + count, 0);
    console.log(
      `Telemetry call-site audit passed (${legacyCount} grandfathered direct calls; new React callers use useTelemetry).`
    );
  }
}
