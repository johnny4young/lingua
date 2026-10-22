import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlConnectionDraft } from '../../../shared/sqlConnections';
import type { SqlDbCatalogView, SqlDbImportResult } from '../../../shared/sqlDb';
import { sqlDbBridge } from '../../runtime/sqlRemote';
import { useSqlConnectionsStore } from '../../stores/sqlConnectionsStore';
import { cn } from '../../utils/cn';
import { ConnectionChip } from './SqlConnectionChip';
import { connectionWhere, importDraft, isAlreadySaved, type SqlImportPasswordMode } from './sqlConnectionManagerModel';
import { BUTTON, LABEL, PRIMARY, Segmented } from './sqlConnectionForm';

/** Who the tunnel signs in as and with which key file, so the user sees it before importing. */
const tunnelLabel = (ssh: NonNullable<SqlConnectionDraft['ssh']>) => `${ssh.user}@${ssh.host}${ssh.keyPath ? ` · ${ssh.keyPath.split(/[\\/]/).pop()}` : ''}`;

interface Props {
  result: Extract<SqlDbImportResult, { canceled: false }>;
  catalog: SqlDbCatalogView;
  onBack: () => void;
  /** After the import, with the sentence to show. */
  onDone: (summary: string) => void;
}

/** What an import found: pick the connections to keep and how their passwords are kept. Nothing comes with a password. */
export function SqlConnectionImport({ result, catalog, onBack, onDone }: Props) {
  const { t } = useTranslation();
  const readOnly = t('sqlWorkspace.connection.readOnlyShort');
  const saved = useMemo(() => catalog.connections, [catalog]);
  const duplicates = useMemo(() => result.found.map((candidate) => isAlreadySaved(candidate, saved)), [result, saved]);
  const room = catalog.limit === null ? Infinity : Math.max(0, catalog.limit - catalog.used);
  const [picked, setPicked] = useState<Set<number>>(() => {
    const fresh = result.found.flatMap((_, index) => (duplicates[index] ? [] : [index]));
    return new Set(fresh.slice(0, room === Infinity ? fresh.length : room));
  });
  const [mode, setMode] = useState<SqlImportPasswordMode>('keychain');
  const [busy, setBusy] = useState(false);
  const vaultSession = catalog.vault === 'session';
  const full = picked.size >= room;

  const toggle = (index: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else if (!full) next.add(index);
      return next;
    });

  const importPicked = async () => {
    const db = sqlDbBridge();
    if (!db) return;
    setBusy(true);
    let imported = 0;
    let failed = 0;
    for (const index of [...picked].sort((a, b) => a - b)) {
      const outcome = await db.save(importDraft(result.found[index]!, mode, vaultSession));
      if (outcome.ok) imported += 1;
      else failed += 1;
    }
    await useSqlConnectionsStore.getState().refresh();
    setBusy(false);
    onDone(
      [t('sqlWorkspace.connection.manager.imported', { count: imported }), failed > 0 ? t('sqlWorkspace.connection.manager.importFailed', { count: failed }) : '']
        .filter(Boolean)
        .join(' ')
    );
  };

  return (
    <div data-testid="sql-connection-import" className="flex flex-col gap-3 py-1">
      <p className="text-body-sm text-fg-muted">
        {t('sqlWorkspace.connection.manager.found', { count: result.found.length })}
        {result.skipped > 0 ? ` ${t('sqlWorkspace.connection.manager.skipped', { count: result.skipped })}` : ''}
      </p>
      {result.found.length > 0 ? (
        <ul className="flex flex-col">
          {result.found.map((candidate, index) => {
            const checked = picked.has(index);
            return (
              <li key={index} className="flex h-[34px] items-center gap-2 border-b border-border-subtle px-1">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && full}
                  onChange={() => toggle(index)}
                  aria-label={candidate.draft.name}
                  data-testid="sql-import-pick"
                  className="focus-ring h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <ConnectionChip connection={candidate.draft} readOnlyLabel={readOnly} />
                <span className="min-w-0 truncate font-mono text-caption text-fg-subtle">{connectionWhere(candidate.draft)}</span>
                {candidate.draft.ssh ? (
                  <span data-testid="sql-import-ssh" className="truncate font-mono text-micro text-fg-muted">
                    {t('sqlWorkspace.connection.manager.viaSsh', { target: tunnelLabel(candidate.draft.ssh) })}
                  </span>
                ) : null}
                {candidate.origin ? <span className="truncate font-mono text-micro text-fg-muted">{candidate.origin}</span> : null}
                {duplicates[index] ? (
                  <span data-testid="sql-import-duplicate" className="ml-auto shrink-0 rounded border border-border-default px-1.5 font-mono text-micro uppercase text-fg-muted">
                    {t('sqlWorkspace.connection.manager.alreadySaved')}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {catalog.limit !== null ? (
        <p data-testid="sql-import-room" className={cn('text-caption', room === 0 ? 'text-warning-fg' : 'text-fg-muted')}>
          {t('sqlWorkspace.connection.manager.room', { count: room, limit: catalog.limit })}
        </p>
      ) : null}
      <div>
        <span className={LABEL}>{t('sqlWorkspace.connection.manager.passwords')}</span>
        {vaultSession ? (
          <p className="mt-1 text-caption text-fg-muted">{t('sqlWorkspace.connection.manager.passwordsSession')}</p>
        ) : (
          <Segmented
            value={mode}
            options={['keychain', 'session'] as const}
            onChange={setMode}
            label={t('sqlWorkspace.connection.manager.passwords')}
            testId="sql-import-password-mode"
            render={(option) => t(`sqlWorkspace.connection.passwordMode.${option}`)}
          />
        )}
        <p className="mt-1.5 text-caption leading-relaxed text-fg-muted">{t('sqlWorkspace.connection.manager.passwordsHint')}</p>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" data-testid="sql-import-confirm" disabled={busy || picked.size === 0} onClick={() => void importPicked()} className={PRIMARY}>
          {t('sqlWorkspace.connection.manager.importCount', { count: picked.size })}
        </button>
        <button type="button" data-testid="sql-import-back" disabled={busy} onClick={onBack} className={BUTTON}>
          {t('sqlWorkspace.connection.manager.back')}
        </button>
      </div>
    </div>
  );
}
