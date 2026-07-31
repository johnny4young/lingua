import { loadDependencyAdapter } from '../../shared/dependencies/registry';
import type {
  DependencyAdapterLanguage,
  DependencyStatus,
  DetectedDependency,
} from '../../shared/dependencies/types';
import type { ClassifiedDependency } from '../stores/dependencyDetectionStore';

export interface DependencyClassificationResult {
  readonly classified: ClassifiedDependency[];
  readonly cwdHasPackageJson: boolean | null;
}

export interface DependencyClassificationRequest {
  readonly content: string;
  readonly language: DependencyAdapterLanguage;
  readonly filePath?: string;
  readonly signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Dependency classification was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function classifyOnWeb(
  dependencies: readonly DetectedDependency[],
  language: DependencyAdapterLanguage
): ClassifiedDependency[] {
  // JS/TS web cannot inspect node_modules. Python rows begin as detected;
  // the async post-pass below upgrades packages already loaded by Pyodide.
  const status: DependencyStatus = language === 'python' ? 'detected' : 'needs-desktop';
  return dependencies.map(dependency => ({ ...dependency, status }));
}

async function classifyPythonOnWeb(
  classified: readonly ClassifiedDependency[]
): Promise<ClassifiedDependency[]> {
  if (classified.length === 0) return classified.slice();
  const { listLoadedPackages } = await import('../services/pythonWebInstaller');
  let loaded: readonly string[];
  try {
    loaded = await listLoadedPackages();
  } catch {
    return classified.slice();
  }
  if (loaded.length === 0) return classified.slice();
  const loadedSet = new Set(loaded);
  return classified.map(dependency =>
    loadedSet.has(dependency.name) && dependency.status === 'detected'
      ? { ...dependency, status: 'installed' as DependencyStatus }
      : dependency
  );
}

async function classifyOnDesktop(
  dependencies: readonly DetectedDependency[],
  language: DependencyAdapterLanguage,
  filePath?: string
): Promise<DependencyClassificationResult> {
  if (language === 'python') {
    return {
      classified: dependencies.map(dependency => ({
        ...dependency,
        status: 'needs-desktop' as const,
      })),
      cwdHasPackageJson: null,
    };
  }

  const names = dependencies.map(dependency => dependency.name);
  if (names.length === 0) return { classified: [], cwdHasPackageJson: null };
  const bridge = window.lingua?.dependencies;
  if (!bridge || typeof bridge.resolveJs !== 'function') {
    return {
      classified: dependencies.map(dependency => ({
        ...dependency,
        status: 'detected' as const,
      })),
      cwdHasPackageJson: null,
    };
  }

  try {
    const result = await bridge.resolveJs(names, filePath);
    return {
      classified: dependencies.map(dependency => {
        const raw = result.statuses[dependency.name];
        const status: DependencyStatus =
          raw === 'installed' ? 'installed' : raw === 'invalid' ? 'unsupported' : 'detected';
        return { ...dependency, status };
      }),
      cwdHasPackageJson: result.hasPackageJson ?? null,
    };
  } catch {
    return {
      classified: dependencies.map(dependency => ({
        ...dependency,
        status: 'detected' as const,
      })),
      cwdHasPackageJson: null,
    };
  }
}

/**
 * Activation-only dependency parser and platform classification pass.
 * The startup hook calls this only after its cheap source preflight finds an
 * import/export/require candidate, so ordinary scratchpads never fetch it.
 */
export async function classifyDependencies({
  content,
  language,
  filePath,
  signal,
}: DependencyClassificationRequest): Promise<DependencyClassificationResult> {
  throwIfAborted(signal);
  const adapter = await loadDependencyAdapter(language);
  throwIfAborted(signal);
  const detected = adapter.detect(content);
  throwIfAborted(signal);
  if (window.lingua?.platform !== 'web') {
    return classifyOnDesktop(detected, language, filePath);
  }

  let classified = classifyOnWeb(detected, language);
  if (language === 'python') {
    classified = await classifyPythonOnWeb(classified);
  }
  return { classified, cwdHasPackageJson: null };
}
