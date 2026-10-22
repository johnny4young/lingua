/**
 * New / edit connection sheet: paste a URL or fill the engine form, keep the
 * password in the keychain or ask for it each session, pick the SSL mode and
 * certificate files, tag the environment, test the connection, then save it
 * or open it for this session only. The password lives in this component's
 * state until it is handed to main and is never stored in the renderer.
 */

import { AlertTriangle, Check, Copy, Database, Loader2, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_PORTS,
  SQL_CONNECTION_ENVS,
  SQL_SSL_MODES,
  parseConnectionDraft,
  parseConnectionUrl,
  withoutUrlPassword,
  type SqlConnectionDraft,
  type SqlConnectionEnv,
  type SqlRemoteEngine,
  type SqlSslMode,
} from '../../../shared/sqlConnections';
import type { SqlDbConnectionView, SqlDbFileKind, SqlDbTestResult } from '../../../shared/sqlDb';
import { sqlConnectionTestedPayload } from '../../hooks/sqlWorkspaceTelemetry';
import { useTelemetry } from '../../hooks/useTelemetry';
import { sqlDbBridge } from '../../runtime/sqlRemote';
import { useSqlConnectionsStore } from '../../stores/sqlConnectionsStore';
import { cn } from '../../utils/cn';
import { pushUpsellNotice } from '../../utils/upsellNotice';
import { ModalShell } from '../ui/ModalShell';
import { copyToClipboard } from './sqlResultActions';
import { CONNECTION_TONE, ENGINE_LABEL } from './sqlConnectionStyle';
import { buildTestReport } from './sqlConnectionReport';
import { BUTTON, INPUT, LABEL, PRIMARY, Segmented } from './sqlConnectionForm';
import { SqlConnectionSafety, type SqlSafetySwitches } from './SqlConnectionSafety';
import { SqlConnectionSshSection } from './SqlConnectionSshSection';
import '../../i18n/sqlConnectionsCatalog';

export type SqlConnectionSheetMode = { kind: 'new' } | { kind: 'url' } | { kind: 'edit'; connection: SqlDbConnectionView };

interface Props {
  mode: SqlConnectionSheetMode;
  onClose: () => void;
  /** After a save or an open: the connection the active query should use. */
  onDone: (connection: SqlDbConnectionView) => void;
}

const ENGINES: SqlRemoteEngine[] = ['postgres', 'mysql', 'sqlite'];

/** Main keeps a saved SSH secret only while the tunnel signs in to the same place the same way. */
const sameTunnel = (a: SqlConnectionDraft['ssh'], b: SqlConnectionDraft['ssh']) =>
  !!a && !!b && a.host === b.host && a.port === b.port && a.user === b.user && a.auth === b.auth && a.keyPath === b.keyPath && JSON.stringify(a.jumps ?? []) === JSON.stringify(b.jumps ?? []);

function blankDraft(engine: SqlRemoteEngine): SqlConnectionDraft {
  return engine === 'sqlite'
    ? { name: '', engine, path: '', readOnly: false, passwordMode: 'none' }
    : { name: '', engine, host: '', port: DEFAULT_PORTS[engine], ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'keychain' };
}

export function SqlConnectionSheet({ mode, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const { track } = useTelemetry();
  const catalog = useSqlConnectionsStore((state) => state.catalog);
  const editing = mode.kind === 'edit' ? mode.connection : null;
  const [draft, setDraft] = useState<SqlConnectionDraft>(() => {
    // The strict parser keeps the draft fields and drops the saved-record ones.
    return (editing && parseConnectionDraft(editing)) || blankDraft('postgres');
  });
  const [password, setPassword] = useState('');
  const [sshSecretInput, setSshSecretInput] = useState('');
  const [trusting, setTrusting] = useState(false);
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlFilled, setUrlFilled] = useState(false);
  const [touchedReadOnly, setTouchedReadOnly] = useState(false);
  const [test, setTest] = useState<SqlDbTestResult | 'running' | null>(null);
  const [busy, setBusy] = useState(false);
  // Deleting also drops the stored password, so it takes a second click.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const vaultSession = catalog?.vault === 'session';
  const atLimit = !editing && mode.kind === 'new' && catalog !== null && catalog.limit !== null && catalog.used >= catalog.limit;
  const network = draft.engine !== 'sqlite';
  const passwordMode = vaultSession && draft.passwordMode === 'keychain' ? 'session' : draft.passwordMode;
  // Without a keychain, a kept SSH secret lasts the session too.
  const ssh = draft.ssh && vaultSession && draft.ssh.secretMode === 'keychain' ? { ...draft.ssh, secretMode: 'session' as const } : draft.ssh;
  const named: SqlConnectionDraft = {
    ...draft,
    passwordMode,
    ...(network && ssh ? { ssh } : {}),
    name: draft.name.trim() || (network ? draft.database || draft.host || '' : draft.path?.split(/[\\/]/).pop() || ''),
  };
  if (!network) delete named.ssh;
  const valid = parseConnectionDraft(named) !== null;
  const secret = password.length > 0 ? password : undefined;
  const sshSecret = sshSecretInput.length > 0 ? sshSecretInput : undefined;
  const safety: SqlSafetySwitches = { readOnly: draft.readOnly, confirmWrites: draft.confirmWrites === true, allowPrivateHost: draft.allowPrivateHost !== false };
  const toggleSafety = (key: keyof SqlSafetySwitches) => {
    if (key === 'readOnly') {
      setTouchedReadOnly(true);
      patch({ readOnly: !draft.readOnly });
    } else if (key === 'confirmWrites') patch({ confirmWrites: !safety.confirmWrites });
    else patch({ allowPrivateHost: !safety.allowPrivateHost });
  };

  const patch = (next: Partial<SqlConnectionDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setTest(null);
  };

  const setEngine = (engine: SqlRemoteEngine) => {
    if (engine === draft.engine) return;
    setDraft({ ...blankDraft(engine), name: draft.name, ...(draft.env ? { env: draft.env } : {}), readOnly: draft.readOnly });
    setTest(null);
  };

  const applyUrl = (value: string) => {
    setUrl(value);
    if (value.trim().length === 0) {
      setUrlError(null);
      return;
    }
    const parsed = parseConnectionUrl(value);
    if ('error' in parsed) {
      setUrlError(t(`sqlWorkspace.connection.urlError.${parsed.error}`));
      setUrlFilled(false);
      return;
    }
    setUrlError(null);
    setUrlFilled(true);
    setDraft((current) => ({ ...parsed.draft, ...(current.env ? { env: current.env } : {}), readOnly: current.readOnly }));
    if (parsed.password !== undefined) {
      setPassword(parsed.password);
      setUrl(withoutUrlPassword(value));
    }
    setTest(null);
  };

  const setEnv = (env: SqlConnectionEnv | undefined) => {
    setDraft((current) => {
      const next: SqlConnectionDraft = { ...current };
      if (env) next.env = env;
      else delete next.env;
      // Production opens read-only unless someone chose otherwise.
      if (!touchedReadOnly) next.readOnly = env === 'prod';
      return next;
    });
  };

  const pick = async (kind: SqlDbFileKind) => {
    const db = sqlDbBridge();
    if (!db) return;
    const picked = await db.pickFile(kind);
    if (picked.canceled) {
      if ('blocked' in picked) setError(t('sqlWorkspace.connection.fileBlocked'));
      return;
    }
    setError(null);
    if (kind === 'sqlite') patch({ path: picked.path });
    else if (kind === 'ssh-key') patch({ ssh: { ...(draft.ssh ?? { host: '', port: 22, user: '', secretMode: 'none' }), auth: 'key', keyPath: picked.path } });
    else patch({ ssl: { ...(draft.ssl ?? { mode: 'verify-full' }), [`${kind === 'ca' ? 'ca' : kind}Path`]: picked.path } as NonNullable<SqlConnectionDraft['ssl']> });
  };

  const runTest = async () => {
    const db = sqlDbBridge();
    if (!db || !valid) return;
    setTest('running');
    // A saved connection tests with what main keeps, unless something was typed or changed.
    const keptPassword = editing && !secret && !sshSecret && editing.hasPassword && JSON.stringify(parseConnectionDraft(editing)) === JSON.stringify(parseConnectionDraft(named));
    const result = await db.test(
      keptPassword ? { connectionId: editing.id } : { draft: named, ...(secret ? { password: secret } : {}), ...(sshSecret ? { sshPassword: sshSecret } : {}) }
    );
    setTest(result);
    track('sql.connection_tested', sqlConnectionTestedPayload(named.engine, result));
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const result =
      mode.kind === 'url' || (atLimit && !editing)
        ? await useSqlConnectionsStore.getState().openAdhoc(named, secret, sshSecret)
        : await useSqlConnectionsStore.getState().save(named, editing?.id, secret, sshSecret);
    setBusy(false);
    if (!result.ok) {
      setError(t(`sqlWorkspace.connection.saveError.${result.reason}`));
      return;
    }
    setPassword('');
    setSshSecretInput('');
    onDone(result.connection);
  };

  const remove = async () => {
    if (!editing) return;
    if (armedDelete !== editing.id) {
      setArmedDelete(editing.id);
      return;
    }
    setBusy(true);
    await useSqlConnectionsStore.getState().remove(editing.id);
    setBusy(false);
    onClose();
  };

  const stepLabel = (id: string) => t(`sqlWorkspace.connection.step.${id}`);
  const report = useMemo(
    () =>
      test && test !== 'running'
        ? buildTestReport(test, named, stepLabel, (status) => (status === 'ok' ? '✓' : status === 'failed' ? '✕' : '–'))
        : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [test]
  );
  const failed = test && test !== 'running' ? test.steps.find((step) => step.status === 'failed') : undefined;
  const trustKey = async () => {
    const key = failed?.hostKey;
    const db = sqlDbBridge();
    if (!key || !db) return;
    setTrusting(true);
    const { ok } = await db.trustHostKey(key.host, key.port, key.fingerprint);
    setTrusting(false);
    if (ok) await runTest();
  };
  const actionLabel =
    mode.kind === 'url' || atLimit ? t('sqlWorkspace.connection.openWithoutSaving') : editing ? t('sqlWorkspace.connection.saveChanges') : t('sqlWorkspace.connection.save');

  return (
    <ModalShell
      onClose={() => !busy && onClose()}
      size="max-w-[720px]"
      bodyMaxHeightClassName="max-h-[min(74vh,680px)]"
      labelledById={titleId}
      headerClose="button"
      closeLabel={t('sqlWorkspace.connection.cancel')}
      icon={<Database size={16} aria-hidden="true" />}
      header={
        <h2 id={titleId} className="truncate text-body-lg font-semibold text-fg-base">
          {editing ? t('sqlWorkspace.connection.editTitle') : mode.kind === 'url' ? t('sqlWorkspace.connection.urlTitle') : t('sqlWorkspace.connection.newTitle')}
        </h2>
      }
      footerLegend={
        <div className="flex min-w-0 items-center gap-2" data-testid="sql-connection-sheet-footer">
          <button type="button" data-testid="sql-connection-save" onClick={() => void save()} disabled={!valid || busy} className={PRIMARY}>
            {busy ? <Loader2 size={12} aria-hidden="true" className="animate-spin" /> : null}
            {actionLabel}
          </button>
          <button type="button" data-testid="sql-connection-test" onClick={() => void runTest()} disabled={!valid || test === 'running'} className={BUTTON}>
            {test === 'running' ? <Loader2 size={12} aria-hidden="true" className="animate-spin" /> : null}
            {t('sqlWorkspace.connection.test')}
          </button>
          {editing ? (
            <button type="button" data-testid="sql-connection-delete" onClick={() => void remove()} disabled={busy} className={cn(BUTTON, 'text-error-fg')}>
              {armedDelete === editing.id ? t('sqlWorkspace.connection.deleteConfirm') : t('sqlWorkspace.connection.delete')}
            </button>
          ) : null}
        </div>
      }
      trailing={error ? <span data-testid="sql-connection-error" role="alert" className="truncate text-caption text-error-fg">{error}</span> : null}
    >
      <div data-testid="sql-connection-sheet" className="flex flex-col gap-3 py-1">
        {atLimit && mode.kind === 'new' ? (
          <div data-testid="sql-connection-limit" className="rounded-[10px] border border-warning-border bg-bg-panel px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-body-sm font-semibold text-fg-base">{t('sqlWorkspace.connection.limitReached', { used: catalog!.used, limit: catalog!.limit })}</span>
              <span className="ml-auto rounded border border-warning-border bg-warning-bg px-1.5 font-mono text-micro font-bold tracking-[0.08em] text-warning-fg">{t('sqlWorkspace.connection.proBadge')}</span>
              <span className="text-caption text-accent-fg">{t('sqlWorkspace.connection.unlimited')}</span>
            </div>
            <p className="mt-1 text-caption leading-relaxed text-fg-muted">{t('sqlWorkspace.connection.limitBody')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" data-testid="sql-connection-replace" onClick={() => setReplacing((value) => !value)} className={BUTTON}>
                {t('sqlWorkspace.connection.replace')}
              </button>
              <button
                type="button"
                data-testid="sql-connection-upgrade"
                onClick={() => pushUpsellNotice({ messageKey: 'upsell.freeCeilingReached', featureLabel: t('upsell.feature.savedDbConnections') })}
                className={BUTTON}
              >
                {t('sqlWorkspace.connection.seePro')}
              </button>
            </div>
            {replacing ? (
              <ul className="mt-2 flex flex-col gap-1" data-testid="sql-connection-replace-list">
                {catalog!.connections.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-2 text-body-sm">
                    <span className={cn('h-[7px] w-[7px] rounded-full', CONNECTION_TONE[entry.env ?? 'none'].dot)} aria-hidden="true" />
                    <span className="truncate">{entry.name}</span>
                    <span className="font-mono text-caption text-fg-muted">{ENGINE_LABEL[entry.engine]}</span>
                    <button
                      type="button"
                      data-testid="sql-connection-replace-delete"
                      onClick={() => {
                        if (armedDelete !== entry.id) setArmedDelete(entry.id);
                        else void useSqlConnectionsStore.getState().remove(entry.id).then(() => setArmedDelete(null));
                      }}
                      className={cn(BUTTON, 'ml-auto h-6 text-error-fg')}
                    >
                      {armedDelete === entry.id ? t('sqlWorkspace.connection.deleteConfirm') : t('sqlWorkspace.connection.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {ENGINES.map((engine) => (
            <button
              key={engine}
              type="button"
              aria-pressed={draft.engine === engine}
              data-testid={`sql-connection-engine-${engine}`}
              onClick={() => setEngine(engine)}
              className={cn(
                'focus-ring h-6 rounded-full border px-2.5 text-caption transition-colors',
                draft.engine === engine ? 'border-accent bg-accent-tint text-accent-fg' : 'border-border-default text-fg-muted hover:text-fg-base'
              )}
            >
              {ENGINE_LABEL[engine]}
            </button>
          ))}
        </div>

        <label className="block">
          <span className={LABEL}>{t('sqlWorkspace.connection.url')}</span>
          <input
            value={url}
            onChange={(event) => applyUrl(event.target.value)}
            placeholder={t('sqlWorkspace.connection.urlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            data-testid="sql-connection-url"
            className={cn(INPUT, urlFilled && 'border-dashed border-accent bg-accent-tint text-accent-fg')}
          />
          <span className={cn('mt-1 block text-caption', urlError ? 'text-error-fg' : 'text-fg-subtle')}>
            {urlError ?? (urlFilled ? t('sqlWorkspace.connection.urlFilled') : t('sqlWorkspace.connection.urlHint'))}
          </span>
        </label>

        <div className="grid grid-cols-[2fr_1fr] gap-2.5">
          <label>
            <span className={LABEL}>{t('sqlWorkspace.connection.name')}</span>
            <input value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder={named.name || t('sqlWorkspace.connection.namePlaceholder')} data-testid="sql-connection-name" className={INPUT} />
          </label>
          <label>
            <span className={LABEL}>{t('sqlWorkspace.connection.group')}</span>
            <input value={draft.group ?? ''} onChange={(event) => patch({ group: event.target.value })} data-testid="sql-connection-group" className={INPUT} />
          </label>
        </div>

        {network ? (
          <>
            <div className="grid grid-cols-[2fr_1fr_1.4fr] gap-2.5">
              <label>
                <span className={LABEL}>{t('sqlWorkspace.connection.host')}</span>
                <input value={draft.host ?? ''} onChange={(event) => patch({ host: event.target.value })} spellCheck={false} data-testid="sql-connection-host" className={INPUT} />
              </label>
              <label>
                <span className={LABEL}>{t('sqlWorkspace.connection.port')}</span>
                <input
                  value={String(draft.port ?? '')}
                  inputMode="numeric"
                  onChange={(event) => patch({ port: Number(event.target.value.replace(/\D/g, '')) || undefined } as Partial<SqlConnectionDraft>)}
                  data-testid="sql-connection-port"
                  className={INPUT}
                />
              </label>
              <label>
                <span className={LABEL}>{t('sqlWorkspace.connection.database')}</span>
                <input value={draft.database ?? ''} onChange={(event) => patch({ database: event.target.value })} spellCheck={false} data-testid="sql-connection-database" className={INPUT} />
              </label>
            </div>
            <div className="grid grid-cols-[1fr_1fr_1fr] items-start gap-2.5">
              <label>
                <span className={LABEL}>{t('sqlWorkspace.connection.user')}</span>
                <input value={draft.user ?? ''} onChange={(event) => patch({ user: event.target.value })} spellCheck={false} autoComplete="off" data-testid="sql-connection-user" className={INPUT} />
              </label>
              <label>
                <span className={LABEL}>{t('sqlWorkspace.connection.password')}</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setTest(null);
                  }}
                  placeholder={editing?.hasPassword ? t('sqlWorkspace.connection.passwordKept') : ''}
                  autoComplete="off"
                  data-testid="sql-connection-password"
                  className={INPUT}
                />
              </label>
              <div>
                <span className={LABEL}>{t('sqlWorkspace.connection.savePassword')}</span>
                <Segmented
                  value={passwordMode === 'none' ? 'keychain' : passwordMode}
                  options={vaultSession ? (['session'] as const) : (['keychain', 'session'] as const)}
                  onChange={(next) => patch({ passwordMode: next })}
                  label={t('sqlWorkspace.connection.savePassword')}
                  testId="sql-connection-password-mode"
                  render={(option) => t(`sqlWorkspace.connection.passwordMode.${option}`)}
                />
              </div>
            </div>
            {vaultSession ? (
              <div data-testid="sql-connection-no-keyring" className="flex items-start gap-2 rounded-[10px] border border-warning-border bg-bg-panel px-3 py-2 text-caption text-fg-muted">
                <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-warning-fg" />
                <span>
                  <span className="block font-semibold text-fg-base">{t('sqlWorkspace.connection.noKeyringTitle')}</span>
                  {t('sqlWorkspace.connection.noKeyringBody')}
                </span>
              </div>
            ) : null}
            <div>
              <span className={LABEL}>{t('sqlWorkspace.connection.sslMode')}</span>
              <Segmented
                value={draft.ssl?.mode ?? 'verify-full'}
                options={SQL_SSL_MODES}
                onChange={(next: SqlSslMode) => patch({ ssl: { ...(draft.ssl ?? {}), mode: next } })}
                label={t('sqlWorkspace.connection.sslMode')}
                testId="sql-connection-ssl"
                render={(option) => option}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {(draft.ssl?.mode === 'disable' ? [] : (['ca', 'cert', 'key'] as const)).map((kind) => {
                  const chosen = draft.ssl?.[`${kind}Path` as 'caPath' | 'certPath' | 'keyPath'];
                  return (
                    <button key={kind} type="button" data-testid={`sql-connection-file-${kind}`} onClick={() => void pick(kind)} className={cn(BUTTON, 'h-6 rounded-full text-caption', chosen && 'border-accent text-accent-fg')}>
                      {chosen ? chosen.split(/[\\/]/).pop() : t(`sqlWorkspace.connection.file.${kind}`)}
                    </button>
                  );
                })}
                <span className="text-caption text-fg-muted" data-testid="sql-connection-ssl-hint">
                  {t(`sqlWorkspace.connection.sslHint.${draft.ssl?.mode ?? 'verify-full'}`)}
                </span>
              </div>
            </div>
            <SqlConnectionSshSection
              ssh={draft.ssh}
              target={`${draft.host || '…'}:${draft.port ?? ''}`}
              onChange={(next) => {
                setSshSecretInput('');
                setDraft((current) => {
                  const updated = { ...current };
                  if (next) updated.ssh = next;
                  else delete updated.ssh;
                  return updated;
                });
                setTest(null);
              }}
              secret={sshSecretInput}
              onSecret={(value) => {
                setSshSecretInput(value);
                setTest(null);
              }}
              secretKept={editing?.hasSshSecret === true && sameTunnel(editing.ssh, draft.ssh)}
              sessionOnly={vaultSession}
              onPickKey={() => void pick('ssh-key')}
            />
          </>
        ) : (
          <div>
            <span className={LABEL}>{t('sqlWorkspace.connection.file.sqlite')}</span>
            <div className="mt-1 flex items-center gap-2">
              <input value={draft.path ?? ''} onChange={(event) => patch({ path: event.target.value })} spellCheck={false} data-testid="sql-connection-path" className={cn(INPUT, 'mt-0')} />
              <button type="button" data-testid="sql-connection-file-sqlite" onClick={() => void pick('sqlite')} className={BUTTON}>
                {t('sqlWorkspace.connection.chooseFile')}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL}>{t('sqlWorkspace.connection.env')}</span>
          {SQL_CONNECTION_ENVS.map((env) => (
            <button
              key={env}
              type="button"
              aria-pressed={draft.env === env}
              data-testid={`sql-connection-env-${env}`}
              onClick={() => setEnv(draft.env === env ? undefined : env)}
              className={cn(
                'focus-ring inline-flex h-6 items-center gap-1.5 rounded-[7px] border px-2 text-caption text-fg-base',
                draft.env === env ? CONNECTION_TONE[env].chip : 'border-border-default'
              )}
            >
              <span aria-hidden="true" className={cn('h-[7px] w-[7px] rounded-full', CONNECTION_TONE[env].dot)} />
              {env}
            </button>
          ))}
        </div>
        <SqlConnectionSafety value={safety} onChange={toggleSafety} network={network} />

        {test ? (
          <section data-testid="sql-connection-test-result" aria-live="polite" className="rounded-[10px] border border-border-subtle bg-bg-panel px-3 py-2">
            {test === 'running' ? (
              <p className="flex items-center gap-2 text-caption text-fg-muted">
                <Loader2 size={12} aria-hidden="true" className="animate-spin" />
                {t('sqlWorkspace.connection.testing')}
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span
                    data-testid="sql-connection-test-badge"
                    className={cn(
                      'rounded border px-1.5 font-mono text-micro font-semibold uppercase tracking-[0.06em]',
                      test.ok ? 'border-success-border bg-success-bg text-success-fg' : 'border-error-border bg-error-bg text-error-fg'
                    )}
                  >
                    {test.ok ? t('sqlWorkspace.connection.connected', { ms: test.totalMs }) : t('sqlWorkspace.connection.failed')}
                  </span>
                  <button
                    type="button"
                    data-testid="sql-connection-copy-report"
                    onClick={() => copyToClipboard(report, { messageKey: 'sqlWorkspace.connection.reportCopied' })}
                    className={cn(BUTTON, 'ml-auto h-6')}
                  >
                    <Copy size={12} aria-hidden="true" />
                    {t('sqlWorkspace.connection.copyReport')}
                  </button>
                </div>
                <ul className="mt-1.5">
                  {test.steps.map((step) => (
                    <li key={step.id} data-testid="sql-connection-step" data-step={step.id} data-status={step.status} className="flex h-7 items-center gap-2.5 border-b border-border-subtle/60 text-body-sm last:border-b-0">
                      {step.status === 'ok' ? (
                        <Check size={12} aria-hidden="true" className="text-success-fg" />
                      ) : step.status === 'failed' ? (
                        <X size={12} aria-hidden="true" className="text-error-fg" />
                      ) : (
                        <span aria-hidden="true" className="w-3 text-center text-fg-subtle">–</span>
                      )}
                      <span className="w-[5.5rem] shrink-0 font-semibold">{stepLabel(step.id)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-caption text-fg-muted" title={step.detail}>
                        {step.id === 'policy' && (step.detail === 'private' || step.detail === 'public') ? t(`sqlWorkspace.connection.policy.${step.detail}`) : step.detail}
                      </span>
                      <span className="font-mono text-caption text-fg-subtle">{step.ms !== undefined ? `${step.ms} ms` : ''}</span>
                    </li>
                  ))}
                </ul>
                {failed?.fix ? (
                  <p data-testid="sql-connection-fix" className="mt-1.5 text-caption leading-relaxed text-fg-muted">
                    {t(`sqlWorkspace.connection.fix.${failed.fix}`)}
                  </p>
                ) : null}
                {failed?.hostKey ? (
                  <div data-testid="sql-connection-host-key" className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-warning-border bg-bg-inset px-2.5 py-2">
                    <span className="min-w-0 flex-1 text-caption text-fg-muted">
                      {t('sqlWorkspace.connection.ssh.trustHint', { host: failed.hostKey.host, port: failed.hostKey.port })}
                      <span data-testid="sql-connection-host-key-fingerprint" className="mt-0.5 block break-all font-mono text-fg-base [font-variant-ligatures:none]">
                        {failed.hostKey.fingerprint}
                      </span>
                    </span>
                    <button type="button" data-testid="sql-connection-trust-key" disabled={trusting} onClick={() => void trustKey()} className={BUTTON}>
                      {t('sqlWorkspace.connection.ssh.trustKey')}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </div>
    </ModalShell>
  );
}
