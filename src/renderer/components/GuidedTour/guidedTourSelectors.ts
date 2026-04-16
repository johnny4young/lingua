export const GUIDED_TOUR_SELECTORS = {
  editor: '#guided-tour-editor',
  runButton: '[data-tour-id="run-button"]',
  console: '#guided-tour-console',
  explorer: '#project-explorer',
  toolbarActions: '[data-tour-id="toolbar-actions"]',
  snippetsSave: '[data-tour-id="snippets-save-active-tab"]',
  commandPaletteSearch: '[data-tour-id="command-palette-search"]',
} as const;

const STEP_WAIT_TIMEOUT_MS = 1800;
const STEP_POLL_INTERVAL_MS = 50;

export function waitForGuidedTourSelector(selector: string) {
  return new Promise<void>((resolve) => {
    const startedAt = performance.now();

    const poll = () => {
      if (document.querySelector(selector)) {
        resolve();
        return;
      }

      if (performance.now() - startedAt >= STEP_WAIT_TIMEOUT_MS) {
        resolve();
        return;
      }

      window.setTimeout(poll, STEP_POLL_INTERVAL_MS);
    };

    poll();
  });
}
