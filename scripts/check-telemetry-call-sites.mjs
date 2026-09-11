import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSourceText, walk } from './lib/estree.mjs';

const TELEMETRY_HOOK_PATH = 'src/renderer/hooks/useTelemetry.ts';

/**
 * internal leaves the non-React and lower-traffic call-site long tail for later
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
  'src/renderer/runners/nodeRunner.ts': 2,
  'src/renderer/runners/python.ts': 3,
  'src/renderer/runners/ruby.ts': 1,
  // The JS and TS runners each held 5 direct calls in their duplicated worker
  // shell. Extracting the shell merged those two sets into this one file, so
  // the ceiling across the three dropped from 10 to 5 and both runner entries
  // are gone rather than zeroed.
  'src/renderer/runners/workerRunnerShell.ts': 5,
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

/** The name an import specifier binds FROM — `a` in `{ a as b }`. */
function importedNameOf(specifier) {
  const imported = specifier.imported;
  if (imported === undefined) return specifier.local.name;
  return imported.type === 'Identifier' ? imported.name : imported.value;
}

function directTrackEventCallCount(sourceText, fileName) {
  const program = parseSourceText(fileName, sourceText);
  const localNames = new Set();

  for (const statement of program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (!targetsTelemetryEmitter(statement.source.value, fileName)) continue;
    for (const specifier of statement.specifiers) {
      // Named bindings only: a default or namespace import cannot bind
      // `trackEvent` by that name, exactly as the previous scan assumed.
      if (specifier.type !== 'ImportSpecifier') continue;
      if (importedNameOf(specifier) === 'trackEvent') {
        localNames.add(specifier.local.name);
      }
    }
  }

  // `import('...').then(({ trackEvent }) => ...)`. In ESTree the dynamic
  // import is an `ImportExpression`, not a call on an import keyword.
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed) return;
    if (callee.property.type !== 'Identifier' || callee.property.name !== 'then') return;
    if (callee.object.type !== 'ImportExpression') return;
    const moduleSpecifier = callee.object.source;
    if (moduleSpecifier.type !== 'Literal') return;
    if (!targetsTelemetryEmitter(moduleSpecifier.value, fileName)) return;
    const callback = node.arguments[0];
    if (
      callback === undefined ||
      (callback.type !== 'ArrowFunctionExpression' && callback.type !== 'FunctionExpression')
    ) {
      return;
    }
    const parameter = callback.params[0];
    if (parameter === undefined || parameter.type !== 'ObjectPattern') return;
    for (const property of parameter.properties) {
      // A rest element binds no single name, as before.
      if (property.type !== 'Property') continue;
      if (property.value.type !== 'Identifier') continue;
      const key = property.key;
      const keyName = key.type === 'Identifier' ? key.name : key.value;
      if (keyName === 'trackEvent') localNames.add(property.value.name);
    }
  });

  let count = 0;
  walk(program, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      localNames.has(node.callee.name)
    ) {
      count += 1;
    }
  });
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
