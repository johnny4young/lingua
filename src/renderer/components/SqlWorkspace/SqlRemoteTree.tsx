import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SqlDbConnectionView, SqlDbObjectInfo, SqlDbSchemaInfo } from '../../../shared/sqlDb';
import { formatCompactNumber, formatNumber } from '../../i18n/formatNumber';
import {
  objectKey,
  useSqlRemoteCatalogStore,
  type SqlCatalogLevel,
  type SqlObjectRef,
} from '../../stores/sqlRemoteCatalogStore';
import { cn } from '../../utils/cn';
import { CONNECTION_TONE, toneOf } from './sqlConnectionStyle';
import { QUERYABLE_KINDS, groupRemoteObjects, matchesObjectFilter } from './sqlRemoteTreeModel';
import { TreeRow } from './SqlTreeRow';

const LEAF = 'flex h-5 items-center gap-[5px] pr-2.5 font-mono text-caption';
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 12 });
const NO_SCHEMAS: SqlDbSchemaInfo[] = [];

export interface SqlRemoteTreeProps {
  connection: SqlDbConnectionView;
  filter: string;
  /** The object the results area shows, if any. */
  selected?: SqlObjectRef | null;
  onOpenObject: (ref: SqlObjectRef) => void;
  onEnterPassword: () => void;
  /** Changes when the Explorer's Collapse all is pressed. */
  collapseSignal?: number;
}

/** One connection's catalog, read a level at a time as its branches open. */
export function SqlRemoteTree({ connection, filter, selected, onOpenObject, onEnterPassword, collapseSignal = 0 }: SqlRemoteTreeProps) {
  const { t, i18n } = useTranslation();
  const catalog = useSqlRemoteCatalogStore(state => state.catalogs[connection.id]);
  const generation = catalog?.generation ?? 0;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['connection']));
  const [opened, setOpened] = useState(false);
  const filtering = filter.trim().length > 0;
  const schemas = catalog?.schemas?.status === 'ready' ? catalog.schemas.value : NO_SCHEMAS;

  useEffect(() => {
    void useSqlRemoteCatalogStore.getState().loadSchemas(connection.id);
  }, [connection.id, generation]);

  // The first schema opens on its tables once, like main does under Local; a refresh keeps what the user folded.
  const first = schemas[0]?.name;
  if (first !== undefined && !opened) {
    setOpened(true);
    setExpanded(previous => new Set([...previous, `schema:${first}`, `group:${first}:tables`]));
  }

  const [collapsedAt, setCollapsedAt] = useState(collapseSignal);
  if (collapsedAt !== collapseSignal) {
    setCollapsedAt(collapseSignal);
    setExpanded(new Set(['connection']));
    setOpened(true);
  }

  const isOpen = (key: string) => expanded.has(key) || (filtering && key !== 'connection' && !key.startsWith('object:'));
  useEffect(() => {
    const store = useSqlRemoteCatalogStore.getState();
    for (const schema of schemas) {
      if (expanded.has(`schema:${schema.name}`)) void store.loadObjects(connection.id, schema.name);
    }
  }, [schemas, expanded, connection.id]);

  const toggle = (key: string) =>
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const selectedKey = selected ? objectKey(selected) : null;
  const tone = CONNECTION_TONE[toneOf(connection.env)];

  const problem = (level: SqlCatalogLevel<unknown> | undefined, depth: number, retry: () => void) =>
    level?.status === 'error' ? (
      <div data-testid="sql-remote-error" style={indent(depth)} className="py-1 pr-2.5 text-caption text-fg-subtle">
        <p className="break-words text-error-fg">
          {level.passwordNeeded ? t('sqlWorkspace.remote.needsPassword') : level.message || t('sqlWorkspace.remote.failed')}
        </p>
        <button
          type="button"
          onClick={level.passwordNeeded ? onEnterPassword : retry}
          data-testid={level.passwordNeeded ? 'sql-remote-enter-password' : 'sql-remote-retry'}
          className="focus-ring mt-1 rounded text-caption font-medium text-accent-fg hover:underline"
        >
          {t(level.passwordNeeded ? 'sqlWorkspace.remote.enterPassword' : 'sqlWorkspace.remote.retry')}
        </button>
      </div>
    ) : null;

  const renderObject = (schema: string, object: SqlDbObjectInfo, depth: number) => {
    const ref: SqlObjectRef = { schema, name: object.name, kind: object.kind, ...(object.signature !== undefined ? { signature: object.signature } : {}) };
    const key = objectKey(ref);
    const columnsKey = `object:${key}`;
    const expandable = QUERYABLE_KINDS.has(object.kind);
    const open = expandable && expanded.has(columnsKey);
    const isSelected = key === selectedKey;
    const columnsLevel = catalog?.columns[schema];
    const columns = open && columnsLevel?.status === 'ready' ? columnsLevel.value.filter(column => column.table === object.name) : [];
    const routine = object.kind === 'function' || object.kind === 'procedure';
    return (
      <li key={key}>
        <div
          style={indent(depth)}
          className={cn('group', LEAF, isSelected ? 'bg-accent-tint shadow-[inset_2px_0_0_var(--color-accent)]' : 'hover:bg-bg-panel-alt')}
        >
          <button
            type="button"
            onClick={() => {
              if (!open) void useSqlRemoteCatalogStore.getState().loadColumns(connection.id, schema);
              toggle(columnsKey);
            }}
            disabled={!expandable}
            aria-expanded={expandable ? open : undefined}
            aria-label={t(open ? 'sqlWorkspace.schema.collapseColumns' : 'sqlWorkspace.schema.expandColumns', { name: object.name })}
            data-testid="sql-remote-expand"
            className="focus-ring w-2 shrink-0 text-left text-fg-subtle disabled:opacity-0"
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenObject(ref)}
            data-testid="sql-remote-object"
            data-object-kind={object.kind}
            data-object-name={object.name}
            aria-current={isSelected ? 'true' : undefined}
            title={t('sqlWorkspace.remote.showObject', { name: `${schema}.${object.name}` })}
            className={cn('focus-ring min-w-0 flex-1 truncate text-left', isSelected ? 'text-accent-fg' : 'text-fg-muted group-hover:text-fg-base')}
          >
            {object.name}
            {routine && object.signature !== undefined ? <span className="text-fg-subtle">({object.signature})</span> : null}
          </button>
          {object.rowEstimate !== undefined ? (
            <span
              data-testid="sql-remote-row-estimate"
              title={t('sqlWorkspace.remote.rowEstimate', { count: object.rowEstimate, value: formatNumber(object.rowEstimate, i18n.language) })}
              className="shrink-0 tabular-nums text-fg-subtle"
            >
              {formatCompactNumber(object.rowEstimate, i18n.language)}
            </span>
          ) : null}
        </div>
        {open && columnsLevel?.status === 'loading' ? (
          <p style={indent(depth + 1)} className={cn(LEAF, 'pl-2.5 text-fg-subtle')}>
            {t('sqlWorkspace.remote.loading')}
          </p>
        ) : null}
        {open ? problem(columnsLevel, depth + 1, () => void useSqlRemoteCatalogStore.getState().loadColumns(connection.id, schema)) : null}
        {columns.length > 0 ? (
          <ul role="list">
            {columns.map(column => (
              <li
                key={column.name}
                data-testid="sql-remote-column"
                style={{ paddingLeft: 8 + (depth + 1) * 12 + 10 }}
                className="flex h-5 items-center gap-2 pr-2.5 font-mono text-caption"
              >
                <span className="min-w-0 flex-1 truncate text-fg-muted">{column.name}</span>
                <span className="max-w-[45%] shrink-0 truncate text-micro uppercase tracking-[0.04em] text-fg-subtle">{column.type}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  const visibleSchemas = useMemo(
    () =>
      schemas.filter(schema => {
        if (!filtering) return true;
        const level = catalog?.objects[schema.name];
        return level?.status === 'ready' && level.value.some(object => matchesObjectFilter(filter, object.name));
      }),
    [schemas, filtering, filter, catalog?.objects]
  );

  return (
    <div data-testid="sql-remote-tree" data-connection-id={connection.id}>
      <TreeRow
        depth={0}
        expanded={expanded.has('connection')}
        onToggle={() => toggle('connection')}
        testId="sql-remote-connection"
        label={
          <>
            <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} />
            <span className="truncate text-fg-base">{connection.name}</span>
          </>
        }
        trailing={
          catalog?.schemas?.status === 'loading' || catalog?.schemas === undefined ? (
            <span className="shrink-0 text-fg-subtle">{t('sqlWorkspace.remote.loading')}</span>
          ) : null
        }
      />
      {expanded.has('connection') ? (
        <>
          {problem(catalog?.schemas, 1, () => void useSqlRemoteCatalogStore.getState().loadSchemas(connection.id))}
          {catalog?.schemas?.status === 'ready' && schemas.length === 0 ? (
            <p style={indent(1)} className="py-1 pr-2.5 text-caption text-fg-subtle">
              {t('sqlWorkspace.remote.noSchemas')}
            </p>
          ) : null}
          <ul role="list">
            {visibleSchemas.map(schema => {
              const schemaKey = `schema:${schema.name}`;
              const level = catalog?.objects[schema.name];
              const objects = level?.status === 'ready' ? level.value : [];
              const groups = level?.status === 'ready' ? groupRemoteObjects(connection.engine, objects, filter) : [];
              return (
                <li key={schema.name}>
                  <TreeRow
                    depth={1}
                    expanded={isOpen(schemaKey)}
                    onToggle={() => toggle(schemaKey)}
                    testId="sql-remote-schema"
                    nodeName={schema.name}
                    label={<span className="truncate">{schema.name}</span>}
                    trailing={
                      <span className="shrink-0 tabular-nums text-fg-subtle">
                        {level?.status === 'loading' ? t('sqlWorkspace.remote.loading') : formatNumber(schema.objects, i18n.language)}
                      </span>
                    }
                  />
                  {isOpen(schemaKey) ? (
                    <>
                      {problem(level, 2, () => void useSqlRemoteCatalogStore.getState().loadObjects(connection.id, schema.name))}
                      <ul role="list">
                        {groups.map(group => {
                          const groupKey = `group:${schema.name}:${group.id}`;
                          return (
                            <li key={group.id}>
                              <TreeRow
                                depth={2}
                                expanded={isOpen(groupKey)}
                                onToggle={() => toggle(groupKey)}
                                testId={`sql-remote-group-${group.id}`}
                                nodeName={schema.name}
                                label={t(`sqlWorkspace.remote.group.${group.id}`)}
                                trailing={<span className="shrink-0 tabular-nums text-fg-subtle">{group.objects.length}</span>}
                              />
                              {isOpen(groupKey) ? (
                                <ul role="list">{group.objects.map(object => renderObject(schema.name, object, 3))}</ul>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                      {level?.status === 'ready' && level.truncated ? (
                        <p data-testid="sql-remote-truncated" style={indent(2)} className="py-1 pr-2.5 text-caption text-fg-subtle">
                          {t('sqlWorkspace.remote.truncated', { value: formatNumber(objects.length, i18n.language) })}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
