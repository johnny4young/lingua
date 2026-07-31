import { pushErrorNotice } from '../utils/statusNotice';
import { loadProjectBundleRuntime } from './projectBundleRuntimeLoader';

export interface UseProjectBundleApi {
  /** Export the active project to a `.zip` bundle. */
  exportProjectBundle: () => Promise<void>;
  /** Import a `.zip` bundle (raw bytes) into a new project folder. */
  importProjectBundle: (zipBytes: Uint8Array) => Promise<void>;
}

async function resolveProjectBundleRuntime() {
  try {
    return await loadProjectBundleRuntime();
  } catch (error: unknown) {
    console.error('[project-bundle] failed to load the project bundle runtime', error);
    pushErrorNotice('projectBundle.load.failed');
    return null;
  }
}

const PROJECT_BUNDLE_API: UseProjectBundleApi = Object.freeze({
  exportProjectBundle: async () => {
    const runtime = await resolveProjectBundleRuntime();
    await runtime?.exportProjectBundle();
  },
  importProjectBundle: async (zipBytes: Uint8Array) => {
    const runtime = await resolveProjectBundleRuntime();
    await runtime?.importProjectBundle(zipBytes);
  },
});

/**
 * Startup-safe project bundle command surface.
 *
 * App, shortcuts, the File Tree, and lazy overlays can all hold these stable
 * callbacks without loading the archive choreography. The implementation
 * arrives only after export/import is explicitly requested.
 */
export function useProjectBundle(): UseProjectBundleApi {
  return PROJECT_BUNDLE_API;
}
