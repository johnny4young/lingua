export type ActiveNotebookExporterModule = typeof import('./exportActiveNotebook');

export type ActiveNotebookExporterImport = () => Promise<ActiveNotebookExporterModule>;

export interface ActiveNotebookExporterLoader {
  readonly load: () => Promise<ActiveNotebookExporterModule>;
}

/**
 * Cache the notebook exporter after its first eligible Command Palette action.
 * Rejected chunk requests are evicted so a later explicit action can retry.
 */
export function createActiveNotebookExporterLoader(
  importExporter: ActiveNotebookExporterImport
): ActiveNotebookExporterLoader {
  let exporterPromise: Promise<ActiveNotebookExporterModule> | null = null;

  return {
    load: () => {
      if (exporterPromise) return exporterPromise;
      const pending = importExporter();
      const guarded = pending.catch((error: unknown) => {
        if (exporterPromise === guarded) exporterPromise = null;
        throw error;
      });
      exporterPromise = guarded;
      return guarded;
    },
  };
}

const exporterLoader = createActiveNotebookExporterLoader(() => import('./exportActiveNotebook'));

/** Load the active-notebook exporter after synchronous tab eligibility passes. */
export function loadActiveNotebookExporter(): Promise<ActiveNotebookExporterModule> {
  return exporterLoader.load();
}
