/**
 * Small app modules the desktop shell loads before its first paint. Rolldown
 * keeps each in its own chunk, shared with the lazy chunks that also use it,
 * and every chunk is one more request through main's app:// handler. A module
 * left off this list only costs its own request; one that stops loading at
 * boot drags its bytes into the initial graph, which the performance budget
 * reports.
 */
export const BOOT_SMALL_MODULES = [
  'src/renderer/data/developerUtilityCatalog.ts',
  'src/renderer/languageIntelligence/createActivationScopedAdapterLoader.ts',
  'src/renderer/stores/announcerStore.ts',
  'src/renderer/stores/commandBus.ts',
  'src/renderer/stores/consoleStore.ts',
  'src/renderer/stores/editorTabUtils.ts',
  'src/renderer/stores/notebookRunnerLockStore.ts',
  'src/renderer/stores/persistence/crossTabSync.ts',
  'src/renderer/stores/persistence/migrationRegistry.ts',
  'src/renderer/stores/recipeStore.ts',
  'src/renderer/stores/resultStore.ts',
  'src/renderer/stores/sqlQueryTabCount.ts',
  'src/renderer/stores/trustEventStore.ts',
  'src/renderer/stores/uiStore.ts',
  'src/renderer/stores/utilityWorkspaceStore.ts',
  'src/renderer/utils/blockedPath.ts',
  'src/renderer/utils/telemetryPolicy.ts',
  'src/renderer/utils/upsellNotice.ts',
  'src/shared/entitlements.ts',
  'src/shared/fs/brandedIds.ts',
  'src/shared/httpSensitiveHeaders.ts',
  'src/shared/languageFamilies.ts',
  'src/shared/workflowMode.ts',
] as const;

const posix = (value: string) => value.replace(/\\/g, '/');

/** One chunk for the modules above; Windows ids may arrive with backslashes. */
export function bootSmallGroup(repoRoot: string) {
  const ids = new Set(BOOT_SMALL_MODULES.map(file => `${posix(repoRoot)}/${file}`));
  return {
    name: 'boot-small',
    test: (id: string) => ids.has(posix(id)),
    priority: 40,
    minSize: 0,
  };
}
