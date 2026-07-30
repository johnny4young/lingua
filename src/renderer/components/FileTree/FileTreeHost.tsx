import { useEffect, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTreeProps } from './FileTree';
import { loadFileTree } from './fileTreeLoader';

type FileTreeComponent = ComponentType<FileTreeProps>;

/**
 * Startup-safe boundary for the project explorer.
 *
 * AppLayout mounts this host only while the persistent sidebar or compact
 * drawer is visible. Until then the recursive tree, menus, windower, bundle
 * actions, and delete confirmation remain outside the initial workspace graph.
 */
export function FileTreeHost({ onNavigate }: FileTreeProps) {
  const { t } = useTranslation();
  const [Tree, setTree] = useState<FileTreeComponent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void loadFileTree()
      .then(module => {
        if (!active) return;
        setTree(() => module.FileTree);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[project-explorer] failed to load the file tree', error);
        setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (Tree) return <Tree onNavigate={onNavigate} />;

  if (failed) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
        role="alert"
        data-testid="project-explorer-load-failed"
      >
        <p className="text-body-sm text-fg-muted">{t('layout.projectExplorer.loadFailed')}</p>
        <button type="button" className="button-secondary" onClick={() => window.location.reload()}>
          {t('layout.projectExplorer.reload')}
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex h-full items-center justify-center px-6 text-center text-body-sm text-fg-muted"
      role="status"
      aria-live="polite"
      data-testid="project-explorer-loading"
    >
      {t('layout.projectExplorer.loading')}
    </div>
  );
}
