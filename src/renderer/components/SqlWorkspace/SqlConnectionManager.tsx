import { Database, Download, MoreHorizontal, Plus } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { parseConnectionDraft } from '../../../shared/sqlConnections';
import type { SqlDbConnectionView, SqlDbImportResult, SqlDbImportSource } from '../../../shared/sqlDb';
import { sqlDbBridge } from '../../runtime/sqlRemote';
import { useSqlConnectionsStore } from '../../stores/sqlConnectionsStore';
import { cn } from '../../utils/cn';
import { ModalFooterLegend } from '../ui/ModalFooterLegend';
import { ModalShell } from '../ui/ModalShell';
import { ConnectionChip } from './SqlConnectionChip';
import { SqlConnectionImport } from './SqlConnectionImport';
import { connectionWhere, duplicateDraft, groupConnections } from './sqlConnectionManagerModel';
import { BUTTON, INPUT, LABEL } from './sqlConnectionForm';
import '../../i18n/sqlConnectionsCatalog';

interface Props {
  /** The open project, whose .env files the .env import reads. */
  project: { rootId: string; name: string } | null;
  onClose: () => void;
  onNew: () => void;
  onEdit: (connection: SqlDbConnectionView) => void;
}

const IMPORT_FILES: Readonly<Record<SqlDbImportSource, string>> = {
  tableplus: 'Connections.plist',
  dbeaver: 'data-sources.json',
  datagrip: 'dataSources.xml',
  lingua: 'lingua-connections.json',
};

type Editing = { kind: 'move'; id: string; value: string } | { kind: 'rename'; group: string; value: string };
type ImportView = { label: string; result: Extract<SqlDbImportResult, { canceled: false }> };

/** Saved connections by group, with search, row actions, imports and a JSON export without secrets. */
export function SqlConnectionManager({ project, onClose, onNew, onEdit }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const groupsId = useId();
  const catalog = useSqlConnectionsStore((state) => state.catalog);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [importing, setImporting] = useState<ImportView | null>(null);
  const readOnly = t('sqlWorkspace.connection.readOnlyShort');

  const connections = useMemo(() => catalog?.connections ?? [], [catalog]);
  const groups = useMemo(() => groupConnections(connections, query), [connections, query]);
  const groupNames = useMemo(() => [...new Set(connections.flatMap((entry) => (entry.group ? [entry.group] : [])))].sort(), [connections]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setNotice(null);
    const failure = await work();
    setBusy(false);
    if (failure) setNotice({ tone: 'error', text: failure });
  };

  const saveGroup = (connection: SqlDbConnectionView, group: string) => {
    const draft = parseConnectionDraft(connection);
    if (!draft) return Promise.resolve({ ok: false as const, reason: 'invalid' as const });
    const next = { ...draft, group: group.trim() || undefined };
    if (!next.group) delete next.group;
    return useSqlConnectionsStore.getState().save(next, connection.id);
  };

  const commitEdit = () =>
    run(async () => {
      const current = editing;
      setEditing(null);
      if (!current) return null;
      const members = current.kind === 'move' ? connections.filter((entry) => entry.id === current.id) : connections.filter((entry) => entry.group === current.group);
      for (const member of members) {
        const result = await saveGroup(member, current.value);
        if (!result.ok) return t(`sqlWorkspace.connection.saveError.${result.reason}`);
      }
      return null;
    });

  const duplicate = (connection: SqlDbConnectionView) =>
    run(async () => {
      const draft = duplicateDraft(connection, t('sqlWorkspace.connection.manager.copySuffix'));
      if (!draft) return t('sqlWorkspace.connection.saveError.invalid');
      const result = await useSqlConnectionsStore.getState().save(draft);
      return result.ok ? null : t(`sqlWorkspace.connection.saveError.${result.reason}`);
    });

  const remove = (connection: SqlDbConnectionView) => {
    if (armedDelete !== connection.id) {
      setArmedDelete(connection.id);
      return;
    }
    setArmedDelete(null);
    setMenu(null);
    void run(async () => ((await useSqlConnectionsStore.getState().remove(connection.id)) ? null : t('sqlWorkspace.connection.saveError.not-found')));
  };

  const startImport = (label: string, read: () => Promise<SqlDbImportResult>) =>
    run(async () => {
      const result = await read();
      if (result.canceled) return null;
      if (result.error) return t(`sqlWorkspace.connection.manager.importError.${result.error}`);
      setImporting({ label, result });
      return null;
    });

  const exportAll = () =>
    run(async () => {
      const result = await sqlDbBridge()?.exportCatalog();
      if (!result || result.canceled) return null;
      if (!result.ok) return t('sqlWorkspace.connection.manager.exportFailed');
      setNotice({ tone: 'ok', text: t('sqlWorkspace.connection.manager.exportDone', { count: result.count }) });
      return null;
    });

  const menuItem = (label: string, onSelect: () => void, testId: string, danger = false) => (
    <button
      type="button"
      role="menuitem"
      data-testid={testId}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onSelect}
      className={cn('focus-ring flex h-7 w-full items-center rounded-md px-2 text-left text-body-sm hover:bg-bg-panel-alt', danger ? 'text-error-fg' : 'text-fg-base')}
    >
      {label}
    </button>
  );

  const groupInput = (value: string, testId: string, label: string) => (
    <input
      autoFocus
      aria-label={label}
      list={groupsId}
      value={value}
      placeholder={t('sqlWorkspace.connection.manager.groupPlaceholder')}
      data-testid={testId}
      onChange={(event) => setEditing((current) => (current ? { ...current, value: event.target.value } : current))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') void commitEdit();
        if (event.key === 'Escape') {
          event.stopPropagation();
          setEditing(null);
        }
      }}
      // Enter saves; leaving the field puts the name back.
      onBlur={() => setEditing(null)}
      className={cn(INPUT, 'mt-0 h-[26px] max-w-[260px]')}
    />
  );

  const row = (connection: SqlDbConnectionView) => {
    const moving = editing?.kind === 'move' && editing.id === connection.id;
    return (
      <li key={connection.id} data-testid="sql-manager-row" data-connection-id={connection.id} className="relative flex h-[34px] items-center gap-2 border-b border-border-subtle px-1">
        {moving ? (
          groupInput(editing.value, 'sql-manager-move-input', t('sqlWorkspace.connection.manager.move'))
        ) : (
          <button type="button" onClick={() => onEdit(connection)} className="focus-ring flex min-w-0 items-center gap-2 rounded-md text-left" aria-label={t('sqlWorkspace.connection.edit', { name: connection.name })}>
            <ConnectionChip connection={connection} readOnlyLabel={readOnly} />
            <span className="truncate font-mono text-caption text-fg-subtle">{connectionWhere(connection)}</span>
          </button>
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu === connection.id}
          aria-label={t('sqlWorkspace.connection.manager.menu', { name: connection.name })}
          data-testid="sql-manager-row-menu"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            setArmedDelete(null);
            setMenu((open) => (open === connection.id ? null : connection.id));
          }}
          className="focus-ring ml-auto rounded p-1 text-fg-subtle hover:text-fg-base"
        >
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
        {menu === connection.id ? (
          <div role="menu" className="absolute right-1 top-[30px] z-10 w-[190px] rounded-lg border border-border-default bg-bg-elevated p-1 shadow-lg">
            {menuItem(t('sqlWorkspace.connection.manager.edit'), () => onEdit(connection), 'sql-manager-edit')}
            {menuItem(t('sqlWorkspace.connection.manager.duplicate'), () => {
              setMenu(null);
              void duplicate(connection);
            }, 'sql-manager-duplicate')}
            {menuItem(t('sqlWorkspace.connection.manager.move'), () => {
              setMenu(null);
              setEditing({ kind: 'move', id: connection.id, value: connection.group ?? '' });
            }, 'sql-manager-move')}
            {menuItem(
              armedDelete === connection.id ? t('sqlWorkspace.connection.deleteConfirm') : t('sqlWorkspace.connection.delete'),
              () => remove(connection),
              'sql-manager-delete',
              true
            )}
          </div>
        ) : null}
      </li>
    );
  };

  const groupHeader = (name: string | undefined, count: number): ReactNode => {
    if (editing?.kind === 'rename' && name !== undefined && editing.group === name) {
      return <div className="mt-3 flex items-center">{groupInput(editing.value, 'sql-manager-rename-input', t('sqlWorkspace.connection.manager.renameGroup'))}</div>;
    }
    return (
      <div className="mt-3 flex items-center gap-2">
        <span className={LABEL}>{name ?? t('sqlWorkspace.connection.manager.noGroup')}</span>
        <span className="font-mono text-micro text-fg-subtle">{count}</span>
        {name !== undefined ? (
          <button
            type="button"
            data-testid="sql-manager-rename"
            onClick={() => setEditing({ kind: 'rename', group: name, value: name })}
            className="focus-ring ml-auto rounded px-1 font-mono text-micro text-fg-subtle hover:text-fg-base"
          >
            {t('sqlWorkspace.connection.manager.renameGroup')}
          </button>
        ) : null}
      </div>
    );
  };

  const importCard = (testId: string, name: string, file: string, onClick: () => void, disabled = false) => (
    <button
      key={testId}
      type="button"
      data-testid={testId}
      disabled={disabled || busy}
      onClick={onClick}
      className="focus-ring mt-1.5 flex w-full items-center gap-2 rounded-[10px] border border-border-subtle bg-bg-panel px-2.5 py-2 text-left text-body-sm text-fg-base hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="shrink-0">{name}</span>
      <span title={file} className="min-w-0 flex-1 truncate text-right font-mono text-caption text-fg-muted">
        {file}
      </span>
    </button>
  );

  const count =
    catalog?.limit === null || catalog === null
      ? t('sqlWorkspace.connection.manager.countUnlimited', { count: connections.length })
      : t('sqlWorkspace.connection.manager.countFree', { used: catalog.used, limit: catalog.limit });

  return (
    <ModalShell
      onClose={() => !busy && onClose()}
      size="max-w-[860px]"
      bodyMaxHeightClassName="max-h-[min(74vh,640px)]"
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('sqlWorkspace.connection.manager.close')}
      icon={<Database size={16} aria-hidden="true" />}
      footerLegend={<ModalFooterLegend navigate={false} select={false} close />}
      header={
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 id={titleId} className="truncate text-body-lg font-semibold text-fg-base">
            {importing ? t('sqlWorkspace.connection.manager.importTitle', { source: importing.label }) : t('sqlWorkspace.connection.manager.title')}
          </h2>
          {importing ? null : (
            <span data-testid="sql-manager-count" className="font-mono text-caption text-fg-subtle">
              {count}
            </span>
          )}
        </div>
      }
      trailing={
        notice ? (
          <span data-testid="sql-manager-notice" role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('truncate text-caption', notice.tone === 'error' ? 'text-error-fg' : 'text-success-fg')}>
            {notice.text}
          </span>
        ) : null
      }
    >
      {importing && catalog ? (
        <SqlConnectionImport
          result={importing.result}
          catalog={catalog}
          onBack={() => setImporting(null)}
          onDone={(text) => {
            setImporting(null);
            setNotice({ tone: 'ok', text });
          }}
        />
      ) : (
        <div data-testid="sql-connection-manager" className="grid grid-cols-1 gap-4 py-1 md:grid-cols-[1fr_300px]">
          <section className="min-w-0">
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t('sqlWorkspace.connection.manager.searchAria')}
                placeholder={t('sqlWorkspace.connection.manager.search')}
                data-testid="sql-manager-search"
                className={cn(INPUT, 'mt-0 min-w-0 max-w-[320px] flex-1')}
              />
              <button type="button" data-testid="sql-manager-new" onClick={onNew} className={cn(BUTTON, 'ml-auto')}>
                <Plus size={12} aria-hidden="true" />
                {t('sqlWorkspace.connection.manager.new')}
              </button>
            </div>
            <datalist id={groupsId}>
              {groupNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {connections.length === 0 ? (
              <p className="mt-4 text-body-sm text-fg-muted">{t('sqlWorkspace.connection.manager.empty')}</p>
            ) : groups.length === 0 ? (
              <p className="mt-4 text-body-sm text-fg-muted">{t('sqlWorkspace.connection.manager.noMatch')}</p>
            ) : (
              groups.map((group) => (
                <div key={group.name ?? ''} data-testid="sql-manager-group" data-group={group.name ?? ''}>
                  {groupHeader(group.name, group.connections.length)}
                  <ul className="mt-1">{group.connections.map(row)}</ul>
                </div>
              ))
            )}
          </section>
          <aside className="min-w-0">
            <span className={LABEL}>{t('sqlWorkspace.connection.manager.import')}</span>
            {(['tableplus', 'dbeaver', 'datagrip'] as const).map((source) =>
              importCard(`sql-manager-import-${source}`, t(`sqlWorkspace.connection.manager.source.${source}`), IMPORT_FILES[source], () =>
                void startImport(t(`sqlWorkspace.connection.manager.source.${source}`), () => sqlDbBridge()!.importFile(source))
              )
            )}
            {importCard(
              'sql-manager-import-env',
              t('sqlWorkspace.connection.manager.source.env'),
              project ? t('sqlWorkspace.connection.manager.envFiles', { project: project.name }) : t('sqlWorkspace.connection.manager.envNoProject'),
              () => project && void startImport(t('sqlWorkspace.connection.manager.source.env'), () => sqlDbBridge()!.importEnv(project.rootId)),
              !project
            )}
            {importCard(`sql-manager-import-lingua`, t('sqlWorkspace.connection.manager.source.lingua'), IMPORT_FILES.lingua, () =>
              void startImport(t('sqlWorkspace.connection.manager.source.lingua'), () => sqlDbBridge()!.importFile('lingua'))
            )}
            <p className="mt-2.5 text-caption leading-relaxed text-fg-muted">{t('sqlWorkspace.connection.manager.importNote')}</p>
            <div className="mt-3 flex items-center gap-2">
              <button type="button" data-testid="sql-manager-export" disabled={busy || connections.length === 0} onClick={() => void exportAll()} className={BUTTON}>
                <Download size={12} aria-hidden="true" />
                {t('sqlWorkspace.connection.manager.export')}
              </button>
            </div>
            <p className="mt-1.5 text-caption leading-relaxed text-fg-muted">{t('sqlWorkspace.connection.manager.exportNote')}</p>
          </aside>
        </div>
      )}
    </ModalShell>
  );
}

