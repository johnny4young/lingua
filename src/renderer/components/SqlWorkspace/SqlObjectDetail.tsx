import { Copy, Play, TextCursorInput } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlDbObjectDetail, SqlDbSecretKind } from '../../../shared/sqlDb';
import { formatByteSize, formatCompactNumber } from '../../i18n/formatNumber';
import { objectKey, useSqlRemoteCatalogStore, type SqlObjectRef } from '../../stores/sqlRemoteCatalogStore';
import { cn } from '../../utils/cn';
import { copyToClipboard } from './sqlResultActions';
import { QUERYABLE_KINDS } from './sqlRemoteTreeModel';

export type SqlObjectTab = 'columns' | 'keys' | 'indexes' | 'ddl' | 'data';

const BUTTON =
  'focus-ring inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border-default bg-bg-panel px-2.5 text-caption text-fg-base transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40';
const TH = 'py-1 pr-4 text-left font-normal text-fg-subtle';
const TD = 'border-t border-border-subtle py-[5px] pr-4 align-top';
/** SQL syntax shown as is in every language. */
const SQL_TOKEN = { select: 'SELECT * LIMIT 100', selectTop: 'SELECT TOP 100 *', primaryKey: 'PRIMARY KEY', foreignKey: 'FOREIGN KEY', unique: 'UNIQUE' } as const;

export interface SqlObjectDetailProps {
  connectionId: string;
  object: SqlObjectRef;
  tab: SqlObjectTab;
  onTab: (tab: SqlObjectTab) => void;
  /** Puts `SELECT * … LIMIT 100` in the editor. */
  onInsertSelect: () => void;
  /** SQL Server writes the first rows as `SELECT TOP`. */
  selectTop?: boolean;
  onEnterPassword: (kind: SqlDbSecretKind) => void;
  /** The object's rows, shown on the Data tab. */
  data: ReactNode;
}

/** A remote object's structure in the results area: columns, keys, indexes, DDL, and its rows. */
export function SqlObjectDetail({ connectionId, object, tab, onTab, onInsertSelect, selectTop, onEnterPassword, data }: SqlObjectDetailProps) {
  const { t, i18n } = useTranslation();
  const key = objectKey(object);
  const level = useSqlRemoteCatalogStore(state => state.catalogs[connectionId]?.details[key]);
  const generation = useSqlRemoteCatalogStore(state => state.catalogs[connectionId]?.generation ?? 0);
  useEffect(() => {
    void useSqlRemoteCatalogStore.getState().loadDetail(connectionId, object);
    // `key` stands for the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, key, generation]);

  const detail = level?.status === 'ready' ? level.value : undefined;
  const queryable = QUERYABLE_KINDS.has(object.kind);
  const tabs: SqlObjectTab[] = queryable ? ['columns', 'keys', 'indexes', 'ddl', 'data'] : ['ddl'];
  const shown = tabs.includes(tab) ? tab : tabs[0]!;
  const facts = [
    detail?.rowEstimate !== undefined ? t('sqlWorkspace.remote.detail.rows', { value: formatCompactNumber(detail.rowEstimate, i18n.language) }) : null,
    detail?.sizeBytes !== undefined ? formatByteSize(detail.sizeBytes, i18n.language) : null,
  ].filter(Boolean);

  return (
    <section
      data-testid="sql-object-detail"
      data-object-kind={object.kind}
      aria-label={`${object.schema}.${object.name}`}
      className="flex h-full min-h-0 flex-col"
    >
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border-subtle px-4 py-2">
        <h2 className="min-w-0 truncate font-mono text-body font-semibold text-fg-base">
          {object.schema}.{object.name}
          {object.signature !== undefined && !queryable ? <span className="font-normal text-fg-subtle">({object.signature})</span> : null}
        </h2>
        <span className="inline-flex h-[18px] shrink-0 items-center rounded border border-border-default px-1.5 font-mono text-micro font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {t(`sqlWorkspace.remote.kind.${object.kind}`)}
        </span>
        {facts.length > 0 ? (
          <span data-testid="sql-object-facts" className="shrink-0 font-mono text-caption text-fg-muted">
            {facts.join(' · ')}
          </span>
        ) : null}
        <span className="flex-1" />
        <div role="tablist" aria-label={t('sqlWorkspace.remote.detail.sections')} className="flex shrink-0 flex-wrap gap-1">
          {tabs.map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={shown === id}
              onClick={() => onTab(id)}
              data-testid={`sql-object-tab-${id}`}
              className={cn(
                'focus-ring h-6 rounded-full border px-2.5 text-caption transition-colors',
                shown === id ? 'border-accent bg-accent-tint text-accent-fg' : 'border-border-default text-fg-muted hover:text-fg-base'
              )}
            >
              {t(`sqlWorkspace.remote.detail.tab.${id}`)}
            </button>
          ))}
        </div>
      </header>
      {shown === 'data' ? (
        <div className="min-h-0 flex-1">{data}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {level === undefined || level.status === 'loading' ? (
            <p className="text-caption text-fg-subtle">{t('sqlWorkspace.remote.loading')}</p>
          ) : level.status === 'error' ? (
            <div data-testid="sql-object-error" className="text-caption">
              <p className="break-words text-error-fg">{level.passwordNeeded ? t('sqlWorkspace.remote.needsPassword') : level.message || t('sqlWorkspace.remote.failed')}</p>
              <button
                type="button"
                onClick={
                  level.passwordNeeded
                    ? () => onEnterPassword(level.passwordNeeded!)
                    : () => void useSqlRemoteCatalogStore.getState().loadDetail(connectionId, object)
                }
                className="focus-ring mt-1 rounded font-medium text-accent-fg hover:underline"
              >
                {t(level.passwordNeeded ? 'sqlWorkspace.remote.enterPassword' : 'sqlWorkspace.remote.retry')}
              </button>
            </div>
          ) : (
            <>
              {shown === 'columns' ? <ColumnsTable detail={level.value} /> : null}
              {shown === 'keys' ? <KeysList detail={level.value} /> : null}
              {shown === 'indexes' ? <IndexesList detail={level.value} /> : null}
              {shown === 'columns' || shown === 'ddl' ? <Ddl ddl={level.value.ddl} /> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!level.value.ddl}
                  onClick={() => copyToClipboard(level.value.ddl ?? '', { messageKey: 'sqlWorkspace.remote.detail.ddlCopied' })}
                  data-testid="sql-object-copy-ddl"
                  className={BUTTON}
                >
                  <Copy size={12} aria-hidden="true" />
                  {t('sqlWorkspace.remote.detail.copyDdl')}
                </button>
                {queryable ? (
                  <>
                    <button type="button" onClick={() => onTab('data')} data-testid="sql-object-open-data" className={BUTTON}>
                      <Play size={12} aria-hidden="true" />
                      {t('sqlWorkspace.remote.detail.openData')}
                    </button>
                    <button type="button" onClick={onInsertSelect} data-testid="sql-object-insert-select" className={cn(BUTTON, 'font-mono')}>
                      <TextCursorInput size={12} aria-hidden="true" />
                      {selectTop ? SQL_TOKEN.selectTop : SQL_TOKEN.select}
                    </button>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ColumnsTable({ detail }: { detail: SqlDbObjectDetail }) {
  const { t } = useTranslation();
  const indexed = new Set(detail.indexes.filter(index => !index.primary).flatMap(index => index.columns));
  return (
    <table data-testid="sql-object-columns" className="w-full border-collapse font-mono text-caption">
      <thead>
        <tr>
          <th className={TH}>{t('sqlWorkspace.remote.detail.column')}</th>
          <th className={TH}>{t('sqlWorkspace.remote.detail.type')}</th>
          <th className={TH}>{t('sqlWorkspace.remote.detail.null')}</th>
          <th className={TH}>{t('sqlWorkspace.remote.detail.default')}</th>
          <th className={TH}>{t('sqlWorkspace.remote.detail.key')}</th>
        </tr>
      </thead>
      <tbody>
        {detail.columns.map(column => (
          <tr key={column.name} data-testid="sql-object-column">
            <td className={cn(TD, 'text-fg-base')}>{column.name}</td>
            <td className={cn(TD, 'text-accent-fg')}>{column.type}</td>
            <td className={cn(TD, 'text-fg-muted')}>{t(column.nullable ? 'sqlWorkspace.remote.detail.yes' : 'sqlWorkspace.remote.detail.no')}</td>
            <td className={cn(TD, 'max-w-[18rem] truncate text-fg-muted')} title={column.default}>
              {column.default ?? ''}
            </td>
            <td className={cn(TD, 'text-fg-muted')}>
              {column.primaryKey
                ? 'PK'
                : column.references
                  ? `FK → ${column.references.table}.${column.references.column}`
                  : indexed.has(column.name)
                    ? 'idx'
                    : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KeysList({ detail }: { detail: SqlDbObjectDetail }) {
  const { t } = useTranslation();
  const primary = detail.columns.filter(column => column.primaryKey).map(column => column.name);
  const foreign = detail.columns.filter(column => column.references);
  if (primary.length === 0 && foreign.length === 0) return <p className="text-caption text-fg-subtle">{t('sqlWorkspace.remote.detail.noKeys')}</p>;
  return (
    <ul data-testid="sql-object-keys" className="space-y-1 font-mono text-caption text-fg-muted">
      {primary.length > 0 ? (
        <li>
          <span className="text-fg-base">{SQL_TOKEN.primaryKey}</span> ({primary.join(', ')})
        </li>
      ) : null}
      {foreign.map(column => (
        <li key={column.name}>
          <span className="text-fg-base">{SQL_TOKEN.foreignKey}</span> ({column.name}) → {column.references!.schema}.{column.references!.table} ({column.references!.column})
        </li>
      ))}
    </ul>
  );
}

function IndexesList({ detail }: { detail: SqlDbObjectDetail }) {
  const { t } = useTranslation();
  if (detail.indexes.length === 0) return <p className="text-caption text-fg-subtle">{t('sqlWorkspace.remote.detail.noIndexes')}</p>;
  return (
    <ul data-testid="sql-object-indexes" className="space-y-1 font-mono text-caption text-fg-muted">
      {detail.indexes.map(index => (
        <li key={index.name} className="flex flex-wrap items-center gap-2">
          <span className="text-fg-base">{index.name}</span>
          <span>({index.columns.join(', ')})</span>
          {index.primary ? <span className="text-micro uppercase text-fg-subtle">PK</span> : index.unique ? <span className="text-micro uppercase text-fg-subtle">{SQL_TOKEN.unique}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Ddl({ ddl }: { ddl?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="mt-3 font-mono text-micro font-semibold uppercase tracking-[0.1em] text-fg-subtle">{t('sqlWorkspace.remote.detail.tab.ddl')}</p>
      {ddl ? (
        <pre data-testid="sql-object-ddl" className="mt-1.5 max-h-72 overflow-auto rounded-lg border border-border-default bg-bg-inset px-2.5 py-2 font-mono text-caption leading-[19px] text-fg-base">
          {ddl}
        </pre>
      ) : (
        <p className="mt-1.5 text-caption text-fg-subtle">{t('sqlWorkspace.remote.detail.noDdl')}</p>
      )}
    </>
  );
}
