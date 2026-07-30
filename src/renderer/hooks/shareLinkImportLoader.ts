interface ShareLinkImportModule {
  importShareLinkHash(rawHash: string): Promise<void>;
}

let importPromise: Promise<ShareLinkImportModule> | null = null;

/**
 * Share one implementation chunk across boot and hashchange imports. A failed
 * fetch is evicted so reloads or later hash changes can retry.
 */
export function loadShareLinkImport(): Promise<ShareLinkImportModule> {
  importPromise ??= import('./shareLinkImport');
  return importPromise.catch((error: unknown) => {
    importPromise = null;
    throw error;
  });
}
