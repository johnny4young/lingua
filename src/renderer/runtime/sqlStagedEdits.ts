import type { StagedEdits } from '../components/SqlWorkspace/sqlRowEditModel';
import type { SqlTablePreview } from '../hooks/useSqlTablePreview';

export interface StagedRowEdits {
  preview: SqlTablePreview;
  edits: StagedEdits;
  count: number;
}

// Kept outside the SQL panel, which unmounts with its tab, so returning restores them and a close can see them.
let staged: StagedRowEdits | null = null;

const askBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

export const stagedRowEdits = () => staged;

export function setStagedRowEdits(next: StagedRowEdits | null): void {
  // On desktop the window close guard asks; a beforeunload there would cancel the close with no prompt.
  if (window.lingua?.platform === 'web' && (staged === null) !== (next === null)) {
    if (next) window.addEventListener('beforeunload', askBeforeUnload);
    else window.removeEventListener('beforeunload', askBeforeUnload);
  }
  staged = next;
}
