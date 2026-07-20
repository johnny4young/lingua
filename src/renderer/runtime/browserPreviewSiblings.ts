import type { FileTab } from '../types';

export interface BrowserPreviewSiblingSources {
  css?: string;
  html?: string;
}

type PreviewAssetKind = keyof BrowserPreviewSiblingSources;

const ASSET_EXTENSION: Record<PreviewAssetKind, string> = {
  css: '.css',
  html: '.html',
};

function normalizePathForScope(tab: FileTab): string {
  return (tab.relativePath ?? tab.filePath ?? tab.name).replace(/\\/gu, '/');
}

function directoryName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function basenameWithoutExtension(name: string): string {
  const normalized = name.replace(/\\/gu, '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  const index = basename.lastIndexOf('.');
  return index === -1 ? basename : basename.slice(0, index);
}

function hasFilesystemScope(tab: FileTab): boolean {
  return Boolean(tab.rootId || tab.relativePath || tab.filePath);
}

function isSameSiblingScope(activeTab: FileTab, candidate: FileTab): boolean {
  const activeHasScope = hasFilesystemScope(activeTab);
  const candidateHasScope = hasFilesystemScope(candidate);

  if (!activeHasScope && !candidateHasScope) {
    return true;
  }

  if (activeTab.rootId || candidate.rootId) {
    return (
      Boolean(activeTab.rootId) &&
      activeTab.rootId === candidate.rootId &&
      directoryName(normalizePathForScope(activeTab)) === directoryName(normalizePathForScope(candidate))
    );
  }

  if (activeHasScope || candidateHasScope) {
    return (
      activeHasScope &&
      candidateHasScope &&
      directoryName(normalizePathForScope(activeTab)) === directoryName(normalizePathForScope(candidate))
    );
  }

  return false;
}

function pickAssetTab(
  tabs: readonly FileTab[],
  activeTab: FileTab,
  kind: PreviewAssetKind
): FileTab | undefined {
  const extension = ASSET_EXTENSION[kind];
  const activeBase = basenameWithoutExtension(activeTab.name).toLowerCase();
  const scoped = tabs.filter(
    (tab) =>
      tab.id !== activeTab.id &&
      tab.name.toLowerCase().endsWith(extension) &&
      isSameSiblingScope(activeTab, tab)
  );

  return (
    scoped.find((tab) => basenameWithoutExtension(tab.name).toLowerCase() === activeBase) ??
    scoped[0]
  );
}

/**
 * implementation note should only seed assets that plausibly belong to the active
 * preview tab. Open editors can contain files from multiple folders or
 * projects, so a global first .css / .html match would leak unrelated
 * markup into the current preview.
 */
export function collectBrowserPreviewSiblingSources(
  tabs: readonly FileTab[],
  activeTab: FileTab
): BrowserPreviewSiblingSources {
  return {
    css: pickAssetTab(tabs, activeTab, 'css')?.content,
    html: pickAssetTab(tabs, activeTab, 'html')?.content,
  };
}
